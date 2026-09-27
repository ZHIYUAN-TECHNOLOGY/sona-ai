import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { GLASSES } from "./home";

/**
 * Glasses of water the patient logs today (Life OS water card), kept on this phone per Malaysia day and
 * read through useSyncExternalStore so React Compiler never caches a stale module read. Patient-entered,
 * never inferred; a new day starts at zero.
 * ponytail: phone-only and not per account, like taken doses; a server log lets the care team see it later.
 */
const KEY = "sona-care.water";
type Log = { day: number; glasses: number };
let log: Log = { day: 0, glasses: 0 };
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
SecureStore.getItemAsync(KEY).then(v => { if (v && !log.day) { log = JSON.parse(v) as Log; listeners.forEach(l => l()); } }).catch(() => {});

/** The Malaysia calendar day, so the count resets at local midnight whatever the phone's zone. */
export const waterDay = (now: Date) => Math.floor((now.getTime() + 8 * 3600_000) / 86_400_000);

/** Today's glasses from a stored log (yesterday's count reads as zero). */
export const glassesOn = (l: Log, now: Date) => l.day === waterDay(now) ? l.glasses : 0;

/** A tap on cup `i` (0-based): an empty cup fills up to it, the last filled cup empties (an undo). */
export const tapCup = (glasses: number, i: number) => Math.max(0, Math.min(GLASSES, i === glasses - 1 ? i : i + 1));

export function setGlasses(glasses: number, now = new Date()) {
  log = { day: waterDay(now), glasses: Math.max(0, Math.min(GLASSES, glasses)) };
  listeners.forEach(l => l());
  SecureStore.setItemAsync(KEY, JSON.stringify(log)).catch(() => {});
}

export const useWater = (now: Date) => glassesOn(useSyncExternalStore(subscribe, () => log), now);
