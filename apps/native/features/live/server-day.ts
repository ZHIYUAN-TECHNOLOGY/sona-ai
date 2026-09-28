import { useEffect, useSyncExternalStore } from "react";
import { useEncounter } from "@/features/encounter/store";
import type { Patient, Task } from "@/features/encounter/types";
import { api, useLive } from ".";
import { serverTasks, type ServerAppointment, type ServerResult, type ServerTask } from "./day";

/**
 * Live mode's tasks, lab results and appointments, held once for every screen that shows them.
 * Screens subscribe with the hooks; plain functions (the home quick actions) read the snapshot.
 * Undefined whenever live mode is off, so callers fall back to the fixtures.
 */
// `bookings`: Sona Care booking requests waiting for the care team (My Day's amber rows).
type Snapshot = { tasks: ServerTask[]; results: ServerResult[]; bookings: ServerBooking[] };
export type ServerBooking = Awaited<ReturnType<typeof api.bookings.list>>[number];
export type ServerData = Snapshot | undefined;
let snapshot: Snapshot | undefined;
// ponytail: appointments cached per date for the session; the month view counts only dates already opened.
const days = new Map<string, ServerAppointment[]>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const serverSnapshot = () => snapshot;
export const serverDayCount = (date: string) => days.get(date)?.length ?? 0;

export async function refreshServerData() {
  // A server without booking yet still serves My Day.
  const [tasks, results, bookings] = await Promise.all([api.tasks.list(), api.results.list(), api.bookings.list().catch(() => [])]);
  snapshot = { tasks, results, bookings };
  notify();
}

/** The server's tasks and results while live mode is on (loaded on first use), else undefined. */
export function useServerData() {
  const { on, wanted } = useLive();
  const value = useSyncExternalStore(subscribe, serverSnapshot);
  useEffect(() => {
    if (on) void refreshServerData().catch(() => {});
    // Only the switch going off clears it: a screen mounting while the session is still loading reads `on` as false too.
    else if (!wanted && snapshot) { snapshot = undefined; days.clear(); notify(); }
  }, [on, wanted]);
  return on ? value : undefined;
}

/** A visit's tasks: the ones made on this device, plus the server's for its encounter in live mode. */
export function useVisitTasks() {
  const server = useServerData();
  const { encounters } = useEncounter();
  return (patient: Patient): Task[] => [...encounters[patient.id]?.tasks ?? [], ...server ? serverTasks(server.tasks, patient.encounterId) : []];
}

/** A date's appointments (YYYY-MM-DD) from the server; undefined until they arrive or when `date` is not given. */
export function useServerDay(date: string | undefined) {
  const rows = useSyncExternalStore(subscribe, () => (date ? days.get(date) : undefined));
  useEffect(() => {
    if (!date) return;
    api.day.list({ date }).then(rows => { days.set(date, rows); notify(); }, () => {});
  }, [date]);
  // The store's value, not a fresh Map read: React Compiler caches reads of module state per `date`.
  return rows;
}

export async function completeServerTask(taskId: string) {
  await api.tasks.complete({ taskId });
  await refreshServerData();
}

/** Saves a follow-up on the server; it then shows from the server's list, never as a device copy. */
export async function createServerTask(input: Parameters<typeof api.tasks.create>[0]) {
  await api.tasks.create(input);
  await refreshServerData();
}

/** Confirms (a visit on the patient's Schedule) or declines (the note goes to their thread) a Sona Care booking request. */
export async function decideBooking(input: Parameters<typeof api.bookings.decide>[0]) {
  const decided = await api.bookings.decide(input);
  await refreshServerData();
  return decided;
}

export async function acknowledgeResult(resultId: string) {
  await api.results.acknowledge({ resultId });
  await refreshServerData();
}
