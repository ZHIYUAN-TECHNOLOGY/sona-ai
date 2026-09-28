import { useSyncExternalStore } from "react";

/**
 * Sona Care's "now": the phone's time plus the hospital's demo clock offset (0 is real time; the
 * server sends it from care.clock and announces a "demo" change when it moves). Everything that reads
 * the current time for the patient (doses due, days home, today's check-in) reads it here, so the
 * app and the server agree when a demo jumps to day 2.
 */
let offset = 0;
const listeners = new Set<() => void>();

export const now = () => new Date(Date.now() + offset);

export function setClockOffset(ms: number) {
  if (ms === offset) return;
  offset = ms;
  listeners.forEach(l => l());
}

/** Re-renders when the demo clock moves; returns the current offset. */
export function useClockOffset() {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => offset);
}
