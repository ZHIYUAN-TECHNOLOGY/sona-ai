import * as Haptics from "expo-haptics";

/** Shared parts live in components/sona/parts; re-exported so reasoning imports stay put. */
export { Caption, Disclosure, IconDisc } from "@/components/sona/parts";

export function haptic(kind: "select" | "done" = "select") {
  if (process.env.EXPO_OS !== "ios") return;
  (kind === "done" ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : Haptics.selectionAsync()).catch(() => {});
}
