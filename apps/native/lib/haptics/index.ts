import * as Haptics from "expo-haptics";

import { hapticPlan, type HapticMoment } from "./plan";

// Signature haptics for the consult flow. Fire-and-forget and never throws — a missing
// native module or a device without a taptic engine simply does nothing. Presentation
// only: no data, nothing persisted or transmitted.

const IMPACT = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
  soft: Haptics.ImpactFeedbackStyle.Soft,
  rigid: Haptics.ImpactFeedbackStyle.Rigid,
} as const;

const NOTIFY = {
  success: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  error: Haptics.NotificationFeedbackType.Error,
} as const;

let enabled = true;

/** Global mute (e.g. from a settings toggle). */
export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

/** Play the haptic for a moment. Safe to call anywhere; swallows all errors. */
export function haptic(moment: HapticMoment): void {
  if (!enabled || process.env.EXPO_OS === "web") return;
  const plan = hapticPlan(moment);
  try {
    if (plan.kind === "impact") void Haptics.impactAsync(IMPACT[plan.strength]);
    else if (plan.kind === "notify") void Haptics.notificationAsync(NOTIFY[plan.strength]);
    else void Haptics.selectionAsync();
  } catch {
    // no taptic engine / native module unavailable — silently ignore
  }
}

export type { HapticMoment };
