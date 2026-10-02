import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

/*
 * The system's Reduce Motion and Reduce Transparency settings, read once for the whole app and kept in sync with
 * changes made while it is open. Each hook used to add its own two listeners and ask iOS on mount, then render a
 * second time with the answer: with 120+ call sites (every glass card), a screen opened with dozens of native calls
 * and a second render pass. Now there is one listener per setting, and the value is known on the first render.
 */
type Setting = { value: boolean; listeners: Set<() => void>; started: boolean };
const motion: Setting = { value: false, listeners: new Set(), started: false };
const transparency: Setting = { value: false, listeners: new Set(), started: false };

function start(s: Setting, event: "reduceMotionChanged" | "reduceTransparencyChanged", read: () => Promise<boolean>) {
  if (s.started) return;
  s.started = true;
  const set = (v: boolean) => { if (s.value !== v) { s.value = v; s.listeners.forEach(l => l()); } };
  AccessibilityInfo.addEventListener(event, set);
  read().then(set, () => {});
}
const subscriber = (s: Setting) => (l: () => void) => { s.listeners.add(l); return () => { s.listeners.delete(l); }; };
const subscribeMotion = subscriber(motion), subscribeTransparency = subscriber(transparency);

/** Keep JS-controlled effects in sync with changes made while the app is open. */
export function useReduceMotionPreference() {
  // Reanimated reads the setting synchronously at launch, so the first render already has it.
  const initial = useReducedMotion();
  if (!motion.started) { motion.value = initial; start(motion, "reduceMotionChanged", () => AccessibilityInfo.isReduceMotionEnabled()); }
  return useSyncExternalStore(subscribeMotion, () => motion.value);
}

export function useReduceTransparencyPreference() {
  start(transparency, "reduceTransparencyChanged", () => AccessibilityInfo.isReduceTransparencyEnabled());
  return useSyncExternalStore(subscribeTransparency, () => transparency.value);
}
