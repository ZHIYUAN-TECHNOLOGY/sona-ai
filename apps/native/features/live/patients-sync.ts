import type { DemoPatient } from "@sona-ai/domain/demo-patients";
import { useEffect, useSyncExternalStore } from "react";
import { api, errorText, useLive } from ".";

/**
 * Live mode's patient records, keyed by patient ID: what the server holds for each person (history,
 * allergies, medicines, vitals, sources) replaces the app's fixture. Held once for every screen that
 * reads them (the visit store, the patient list, the judge build's gate) and kept per signed-in
 * account, so one person's read is never shown to the next.
 */
type Read = { userId?: string; records?: Record<string, DemoPatient>; error?: string };
let held: Read = {};
// The account a read is in flight for: one read serves every caller, and an answer for an account since signed out is dropped.
let reading: string | undefined;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

function readPatients(userId: string) {
  if (reading === userId) return;
  reading = userId;
  const settle = (next: Omit<Read, "userId">) => {
    if (reading !== userId) return;
    reading = undefined;
    // An unchanged answer keeps the records already held: a new object re-rendered every screen that reads the visit
    // store, each time Patients (or anything else reading them) opened.
    if (held.userId === userId && !held.error && !next.error && JSON.stringify(held.records) === JSON.stringify(next.records)) return;
    // A failed re-read keeps the records already read for this account, beside the reason it failed.
    held = { userId, records: held.userId === userId ? held.records : undefined, ...next };
    listeners.forEach(l => l());
  };
  api.patients.list().then(rows => settle({ records: Object.fromEntries(rows.map(p => [p.id, p])), error: undefined }), e => settle({ error: errorText(e) }));
}

/**
 * The read itself: the records (undefined until they arrive, or when live mode is off), the server's
 * reason when it failed, and `retry`. Reads when live mode comes on and each time a reader mounts.
 */
export function usePatientsRead() {
  const { on, user } = useLive();
  const read = useSyncExternalStore(subscribe, () => held);
  const userId = on ? user?.id : undefined;
  useEffect(() => { if (userId) readPatients(userId); }, [userId]);
  const mine = userId && read.userId === userId ? read : undefined;
  return { records: mine?.records, error: mine?.error, retry: () => { if (userId) readPatients(userId); } };
}

/** The records alone: undefined until they arrive or when live mode is off, so the app shows its fixtures instead. */
export const useServerPatients = () => usePatientsRead().records;
