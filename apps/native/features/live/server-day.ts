import { useEffect, useSyncExternalStore } from "react";
import { useEncounter } from "@/features/encounter/store";
import type { Patient, Task } from "@/features/encounter/types";
import { visitTasks } from "@/features/day/counts";
import { api, errorText, useLive } from ".";
import { keepSame } from "./keep-same";
import type { ServerAppointment, ServerResult, ServerTask } from "./day";

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
// Today's widgets each load on mount, about 18 at once on a cold start: the read in flight, or one just done, serves them all.
const SHARED_MS = 2500;
let loading: Promise<void> | undefined, loadedAt = 0;
// ponytail: appointments cached per date for the session; the month view counts only dates already opened.
const days = new Map<string, ServerAppointment[]>();
// Today, the sidebar and the quick actions read today's visits at once: one read per date in flight serves them.
const dayReads = new Map<string, Promise<void>>();
// Why a date's read failed, until a read of it succeeds: a failed day is said as that, never shown as an empty one.
const dayErrors = new Map<string, string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const serverSnapshot = () => snapshot;
export const serverDayCount = (date: string) => days.get(date)?.length ?? 0;
export const serverDayError = (date: string) => dayErrors.get(date);

/** Reads a date's appointments unless a read of it is in flight; a failure is kept as its reason (serverDayError) and can be read again. */
export function readServerDay(date: string) {
  if (!dayReads.has(date)) dayReads.set(date, api.day.list({ date })
    .then(rows => { days.set(date, keepSame(days.get(date), rows)); dayErrors.delete(date); }, e => { dayErrors.set(date, errorText(e)); })
    .finally(() => { dayReads.delete(date); notify(); }));
  return dayReads.get(date)!;
}

/** A read this role may not make is simply empty (a bed manager has no results); any other failure still fails the refresh. */
const unlessRefused = <T>(read: Promise<T[]>) => read.catch(e => (e as { code?: string } | undefined)?.code === "FORBIDDEN" ? [] as T[] : Promise.reject(e));

/** A fresh read, as after a write or a live change. */
export async function refreshServerData() {
  // Each read stands alone: one the role is refused never drops Today back to the demo data. A server without booking yet still serves My Day.
  const [tasks, results, bookings] = await Promise.all([unlessRefused(api.tasks.list()), unlessRefused(api.results.list()), api.bookings.list().catch(() => [])]);
  snapshot = keepSame(snapshot, { tasks, results, bookings }); loadedAt = Date.now();
  notify();
}

/** A screen mounting: reads unless a read is in flight or one finished moments ago. */
export function loadServerData() {
  if (!loading && (!snapshot || Date.now() - loadedAt > SHARED_MS)) loading = refreshServerData().finally(() => { loading = undefined; });
  return loading ?? Promise.resolve();
}

/** The server's tasks and results while live mode is on (loaded on first use), else undefined. */
export function useServerData() {
  const { on, wanted } = useLive();
  const value = useSyncExternalStore(subscribe, serverSnapshot);
  useEffect(() => {
    if (on) void loadServerData().catch(() => {});
    // Only the switch going off clears it: a screen mounting while the session is still loading reads `on` as false too.
    else if (!wanted && snapshot) { snapshot = undefined; days.clear(); dayErrors.clear(); notify(); }
  }, [on, wanted]);
  return on ? value : undefined;
}

/** A visit's tasks: the ones made on this device, plus the server's for its encounter in live mode. */
export function useVisitTasks() {
  const server = useServerData();
  const { encounters } = useEncounter();
  return (patient: Patient): Task[] => visitTasks(patient, encounters, server);
}

/** A date's appointments (YYYY-MM-DD) from the server; undefined until they arrive or when `date` is not given. */
export function useServerDay(date: string | undefined) {
  const rows = useSyncExternalStore(subscribe, () => (date ? days.get(date) : undefined));
  useEffect(() => { if (date) void readServerDay(date); }, [date]);
  // The store's value, not a fresh Map read: React Compiler caches reads of module state per `date`.
  return rows;
}

/**
 * Why `useServerDay(date)` is still undefined: the read failed (the server's reason), with `retry` to read again.
 * Undefined while it loads or once it has arrived. A sibling hook, so useServerDay's callers are untouched.
 */
export function useServerDayError(date: string | undefined) {
  const error = useSyncExternalStore(subscribe, () => (date ? dayErrors.get(date) : undefined));
  return error && date ? { error, retry: () => { dayErrors.delete(date); notify(); void readServerDay(date); } } : undefined;
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

/** Acknowledges a result for the team (the briefing's and the critical alert's button); a refusal throws for the caller to show. */
export async function acknowledgeResult(resultId: string) {
  await api.results.acknowledge({ resultId });
  await refreshServerData();
}
