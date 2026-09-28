import { useEffect, useState, useSyncExternalStore } from "react";
import { Easing, FadeInDown } from "react-native-reanimated";
import { useDischarge } from "@/features/discharge/row";
import { dueNow, nextDose } from "./model";
import { Pill, tintOf } from "./pill";
import { now as clockNow, useClockOffset } from "@/lib/clock";

import { listeners, subscribe, takenNow } from "./log";
export { clearTaken, markTaken, syncTaken } from "./log";

/**
 * "Remind me later": the dose card steps aside until `until` (ms), in this app only (no notification
 * is scheduled, so the screen says it shows here again). Kept beside the taken log so every screen agrees.
 */
let snoozed: { key: string; until: number } | undefined;
export function snooze(next: typeof snoozed) {
  snoozed = next;
  listeners.forEach(l => l());
}
export const useSnooze = () => useSyncExternalStore(subscribe, () => snoozed);

/** The clock, ticking every 30 seconds by default, so countdowns and "due now" move on their own. */
/** The current time on the demo clock (see lib/clock), ticking every `every` ms and whenever the clock jumps. */
export function useNow(every = 30_000) {
  const offset = useClockOffset();
  const [now, setNow] = useState(clockNow);
  useEffect(() => { setNow(clockNow()); const id = setInterval(() => setNow(clockNow()), every); return () => clearInterval(id); }, [every, offset]);
  return now;
}

/** The next dose from the discharge plan, or undefined (still in hospital, or nothing on a schedule), with the timed medicines and what is taken. */
export function useNextDose(now: Date) {
  const { data } = useDischarge();
  const done = useSyncExternalStore(subscribe, takenNow);
  if (data?.status !== "discharged") return { plan: data, dose: undefined, taken: done, meds: [] };
  const { medicines: m } = data, meds = [...m.new, ...m.changed, ...m.continue];
  return { plan: data, dose: nextDose(meds, data.dischargedAt, done, now), taken: done, meds };
}

export function useDoseNeeds() {
  const now = useNow();
  const { dose } = useNextDose(now);
  return dose && dueNow(dose.dueAt, now) ? 1 : 0;
}

export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/** Home's cards rise in one after another, 40 ms apart (ease-out); still under Reduce Motion. */
export const rise = (reduced: boolean, index: number) => reduced ? undefined : FadeInDown.duration(320).delay(index * 40).easing(EASE_OUT);

export { Pill, tintOf };
