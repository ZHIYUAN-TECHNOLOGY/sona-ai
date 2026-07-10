// Pure moment→haptic mapping. No native import, so it's unit-testable in Node. The
// native fire() (./index) resolves these to expo-haptics calls.

export type HapticMoment =
  | "recordStart" // begin capturing a consult
  | "recordStop" // end consult
  | "redactionDone" // PII stripped, privacy gate ready
  | "noteReady" // AI note finished drafting
  | "signSuccess" // note signed + sealed
  | "select" // tab / segment change
  | "tap" // primary CTA press
  | "warn"
  | "error";

export type ImpactStrength = "light" | "medium" | "heavy" | "soft" | "rigid";
export type NotifyStrength = "success" | "warning" | "error";

export type HapticPlan =
  | { kind: "impact"; strength: ImpactStrength }
  | { kind: "notify"; strength: NotifyStrength }
  | { kind: "selection" };

/** Map a moment to its haptic. Success/failure moments notify; presses impact. */
export function hapticPlan(moment: HapticMoment): HapticPlan {
  switch (moment) {
    case "recordStart":
      return { kind: "impact", strength: "medium" };
    case "recordStop":
      return { kind: "impact", strength: "soft" };
    case "redactionDone":
      return { kind: "impact", strength: "light" };
    case "noteReady":
      return { kind: "notify", strength: "success" };
    case "signSuccess":
      return { kind: "notify", strength: "success" };
    case "select":
      return { kind: "selection" };
    case "tap":
      return { kind: "impact", strength: "light" };
    case "warn":
      return { kind: "notify", strength: "warning" };
    case "error":
      return { kind: "notify", strength: "error" };
  }
}
