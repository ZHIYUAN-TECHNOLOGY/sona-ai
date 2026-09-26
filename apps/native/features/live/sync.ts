import { useCallback, useEffect } from "react";
import { useEncounter } from "@/features/encounter/store";
import type { Patient } from "@/features/encounter/types";
import { api, useLive } from ".";
import { mergeServerState, type ServerVisitState } from "./day";

/**
 * In live mode, pulls the server's record of a visit into the app's encounter so every screen renders
 * what the server holds (see `mergeServerState`): medicines, discharge and claim fixes, claim status,
 * and whether the guarantee letter has arrived (the server's bed no longer lists that blocker).
 */
export function useServerEncounter(patient: Patient | undefined) {
  const { on } = useLive();
  const { updateEncounter } = useEncounter();
  const encounterId = patient?.encounterId, patientId = patient?.id;
  const refresh = useCallback(async () => {
    if (!on || !encounterId) return;
    // The status call settles the insurer's answer first, so the bed list read after it is current.
    const claim = await api.claim.status({ encounterId });
    const [snapshot, beds] = await Promise.all([api.encounter.get({ encounterId }), api.ward.beds()]);
    const bed = beds.find(b => b.blockers.some(x => x.id.startsWith("adm-1042")) || b.admissionId === "adm-1042");
    const glReceived = !bed || !bed.blockers.some(x => x.kind === "gl");
    updateEncounter(value => mergeServerState(value, snapshot.state as ServerVisitState, claim, glReceived), false, patientId);
  // Keyed on the encounter ID: the patient object is rebuilt on every render.
  }, [on, encounterId, patientId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh().catch(() => {}); }, [refresh]);
  // While the claim is with the insurer, keep checking so the guarantee letter clears on whichever screen is open.
  const { encounters } = useEncounter();
  const waiting = on && patient ? encounters[patient.id]?.claim?.status === "sent" : false;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => { void refresh().catch(() => {}); }, 5000);
    return () => clearInterval(timer);
  }, [waiting, refresh]);
  return { live: on, refresh };
}
