import type { EncounterEdit } from "@sona-ai/api/contracts";
import { useCallback, useEffect, useState } from "react";
import { useEncounter } from "@/features/encounter/store";
import type { Encounter, Patient } from "@/features/encounter/types";
import { api, errorText, useLive } from ".";
import { useLiveChanges } from "./channel";
import { mergeServerState, type ServerVisitState } from "./day";

/**
 * In live mode, pulls the server's record of a visit into the app's encounter so every screen renders
 * what the server holds (see `mergeServerState`): medicines, discharge and claim fixes, claim status,
 * and whether the guarantee letter has arrived (the server's bed no longer lists that blocker).
 */
// Reads shared across every screen showing a visit (only touched inside callbacks, never during render).
const inflight = new Map<string, Promise<void>>();
const lastRead = new Map<string, number>();
const SHARED_MS = 2500;

export function useServerEncounter(patient: Patient | undefined) {
  const { on } = useLive();
  const { updateEncounter } = useEncounter();
  const encounterId = patient?.encounterId, patientId = patient?.id;
  /** `force` skips the shared-read window (after a refusal the screen needs the server as it is now). */
  const refresh = useCallback(async (force = false) => {
    if (!on || !encounterId) return;
    // Several screens show the same visit at once; they share one read instead of each polling the server.
    const running = inflight.get(encounterId);
    if (running) return running;
    if (!force && Date.now() - (lastRead.get(encounterId) ?? 0) < SHARED_MS) return;
    const read = (async () => {
      // The status call settles the insurer's answer first, so the bed list read after it is current.
      const claim = await api.claim.status({ encounterId });
      const [snapshot, beds] = await Promise.all([api.encounter.get({ encounterId }), api.ward.beds()]);
      const bed = beds.find(b => b.blockers.some(x => x.id.startsWith("adm-1042")) || b.admissionId === "adm-1042");
      const glReceived = !bed || !bed.blockers.some(x => x.kind === "gl");
      updateEncounter(value => mergeServerState(value, snapshot.state as ServerVisitState, claim, glReceived), false, patientId);
    })().finally(() => { inflight.delete(encounterId); lastRead.set(encounterId, Date.now()); });
    inflight.set(encounterId, read);
    return read;
  // Keyed on the encounter ID: the patient object is rebuilt on every render.
  }, [on, encounterId, patientId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh().catch(() => {}); }, [refresh]);
  // Live updates: re-read as soon as the server says this visit changed (a claim decided, a discharge, an edit elsewhere).
  useLiveChanges(["visit"], () => { void refresh(true).catch(() => {}); }, encounterId);
  // While the claim is with the insurer, keep checking so the guarantee letter clears on whichever screen is open.
  const { encounters } = useEncounter();
  const waiting = on && patient ? encounters[patient.id]?.claim?.status === "sent" : false;
  useEffect(() => {
    if (!waiting) return;
    // Safety net only: the insurer's decision normally arrives over live updates.
    const timer = setInterval(() => { void refresh().catch(() => {}); }, 30_000);
    return () => clearInterval(timer);
  }, [waiting, refresh]);
  return { live: on, refresh };
}

type EditFields = Omit<EncounterEdit, "encounterId" | "expectedRevision">;
/** Merges a server snapshot after an edit; the claim status and letter stay as the app last read them. */
const mergeEdited = (value: Encounter, state: unknown) =>
  mergeServerState(value, state as ServerVisitState, { status: value.claim?.status ?? "draft", approvedAt: value.claim?.approvedAt }, value.discharge?.glReceived ?? false);

/**
 * A history or medicine edit. In live mode it is saved to the server at its current revision first,
 * then `apply` runs locally and the server's record is merged back; a refusal (someone else wrote
 * first) reloads the server's record and keeps the doctor's draft, so nothing typed is lost.
 * Fixture mode applies it at once, as before.
 */
export function useEncounterEdit(patient: Patient) {
  const { on } = useLive();
  const { updateEncounter } = useEncounter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const save = (fields: EditFields, apply: (value: Encounter) => Encounter, onSaved?: () => void) => {
    if (!on) { updateEncounter(apply, true); onSaved?.(); return; }
    const { encounterId } = patient, patientId = patient.id;
    setSaving(true); setError(undefined);
    api.encounter.get({ encounterId })
      .then(({ revision }) => api.encounter.edit({ encounterId, expectedRevision: revision, ...fields }))
      .then(snapshot => { updateEncounter(value => mergeEdited(apply(value), snapshot.state), true, patientId); onSaved?.(); }, async e => {
        setError(errorText(e));
        const snapshot = await api.encounter.get({ encounterId }).catch(() => undefined);
        if (snapshot) updateEncounter(value => mergeEdited(value, snapshot.state), false, patientId);
      })
      .finally(() => setSaving(false));
  };
  return { saving, error, save };
}
