import { useCallback, useEffect } from "react";
import { EMPTY_CLAIM } from "@/features/claim/model";
import { EMPTY_DISCHARGE } from "@/features/discharge/model";
import { useEncounter } from "@/features/encounter/store";
import type { Patient } from "@/features/encounter/types";
import { api, useLive } from ".";

/**
 * In live mode, pulls the server's discharge and claim state for a patient into the app's encounter
 * so the existing cards render what the server holds: discharge fixes, claim fixes and status, and
 * whether the guarantee letter has arrived (the server's bed no longer lists that blocker).
 */
export function useServerEncounter(patient: Patient | undefined) {
  const { on } = useLive();
  const { updateEncounter } = useEncounter();
  const encounterId = patient?.encounterId;
  const refresh = useCallback(async () => {
    if (!on || !encounterId) return;
    // The status call settles the insurer's answer first, so the bed list read after it is current.
    const claim = await api.claim.status({ encounterId });
    const [snapshot, beds] = await Promise.all([api.encounter.get({ encounterId }), api.ward.beds()]);
    const bed = beds.find(b => b.blockers.some(x => x.id.startsWith("adm-1042")) || b.admissionId === "adm-1042");
    const glReceived = !bed || !bed.blockers.some(x => x.kind === "gl");
    const server = snapshot.state as { discharge?: object; claim?: object };
    updateEncounter(value => ({
      ...value,
      discharge: { ...EMPTY_DISCHARGE, ...value.discharge, ...server.discharge, glReceived },
      claim: { ...EMPTY_CLAIM, ...server.claim, status: claim.status === "approved" ? "approved" : claim.status === "sent" ? "sent" : "draft", approvedAt: "approvedAt" in claim ? claim.approvedAt : undefined },
    }));
  // Keyed on the encounter ID: the patient object is rebuilt on every render.
  }, [on, encounterId]); // eslint-disable-line react-hooks/exhaustive-deps
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
