import { useEffect, useSyncExternalStore } from "react";
import { useEncounter } from "@/features/encounter/store";
import { api, useLive } from "@/features/live";
import { completeServerTask, refreshServerData } from "@/features/live/server-day";
import { fixtureCheckIns, fixtureReply, type CheckIn } from "./model";

/**
 * Check-ins for every screen that shows them: the server's in live mode, else the fixture derived
 * from this device's discharges plus the replies simulated here. One store, read through
 * useSyncExternalStore, so React Compiler never caches a stale module read.
 */
// `kept`: flags just booked in whose row stays on My Day while it offers same-visit follow-ups.
type Store = { replies: Record<string, CheckIn["replies"]>; server?: CheckIn[]; kept: string[] };
let store: Store = { replies: {}, kept: [] };
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const set = (patch: Partial<Store>) => { store = { ...store, ...patch }; listeners.forEach(l => l()); };

export async function refreshCheckIns() { set({ server: await api.checkIns.list() }); }

export function useCheckIns(): CheckIn[] {
  const { on, wanted } = useLive();
  const snapshot = useSyncExternalStore(subscribe, () => store);
  const { patients, encounters } = useEncounter();
  useEffect(() => {
    if (on) void refreshCheckIns().catch(() => {});
    else if (!wanted) set({ server: undefined });
  }, [on, wanted]);
  if (on) return snapshot.server ?? [];
  const now = new Date();
  return patients.flatMap(p => fixtureCheckIns(p, encounters[p.id]?.discharge, snapshot.replies, now));
}

/** The simulated patient reply; in live mode the server reads it and makes the task. */
export async function simulateReply(checkIn: CheckIn, patientName: string, text: string, live: boolean) {
  if (live) {
    await api.checkIns.reply({ checkInId: checkIn.id, text });
    await Promise.all([refreshCheckIns(), refreshServerData()]);
    return;
  }
  set({ replies: { ...store.replies, [checkIn.id]: [...(store.replies[checkIn.id] ?? []), fixtureReply(patientName, text, new Date())] } });
}

/** Called back or booked in (both simulated): the flagged task is done, so the row leaves My Day. */
export async function resolveFlag(taskId: string, live: boolean) {
  if (live) {
    await completeServerTask(taskId);
    await refreshCheckIns();
    return;
  }
  set({ replies: Object.fromEntries(Object.entries(store.replies).map(([id, list]) => [id, list.map(r => (r.task?.id === taskId ? { ...r, task: { ...r.task, completed: true } } : r))])) });
}

/**
 * Book in (live mode): the server books the patient's clinic review at the slot picked (with that
 * doctor), closes the flag and tells her Sona Care; the result says when. Booking the same flag again
 * moves the visit. Off live mode it is simulated like Call back.
 */
export async function bookIn(taskId: string, live: boolean, slot?: { startsAt: Date; doctorId: string }) {
  if (!live) { await resolveFlag(taskId, false); return undefined; }
  const booked = await api.checkIns.bookIn({ taskId, ...slot });
  // The flag is closed on the server; its row stays while it offers the X-ray follow-ups for the same visit.
  if (booked.toAdd.length) set({ kept: [...store.kept, taskId] });
  await Promise.all([refreshCheckIns(), refreshServerData()]);
  return booked;
}

/** Puts a finding's follow-up test on the visit just booked (same trip); her Sona Care shows it at once. */
export async function addToVisit(findingId: string, appointmentId: string) {
  const added = await api.findings.addToVisit({ findingId, appointmentId });
  await refreshServerData();
  return added;
}

/** Flags kept on My Day after Book in (see bookIn); the row leaves once the doctor is done with it. */
export const useKeptFlags = () => useSyncExternalStore(subscribe, () => store.kept);
export function releaseFlag(taskId: string) { set({ kept: store.kept.filter(id => id !== taskId) }); }
