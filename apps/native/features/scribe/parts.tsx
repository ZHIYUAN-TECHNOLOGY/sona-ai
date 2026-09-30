import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { Text } from "@/components/sona/text";
import { palette, radius, type } from "@/components/sona/theme";
import { Icon } from "@/components/sona/ui";
import type { NoteSections } from "./model";

/** One haptic per user action, fired with its visual. iOS only; never the only feedback. */
export function haptic(kind: "tap" | "done" | "warn") {
  if (process.env.EXPO_OS !== "ios") return;
  (kind === "tap" ? Haptics.selectionAsync() : Haptics.notificationAsync(kind === "done" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning)).catch(() => {});
}

/** A quiet line of state: icon and text, no box. Warnings turn amber. */
export function StateLine({ children, warning = false, icon }: { children: ReactNode; warning?: boolean; icon?: string }) {
  const color = warning ? palette.amber : palette.muted;
  return <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
    <View style={{ paddingTop: 2 }}><Icon name={icon ?? (warning ? "exclamationmark.circle" : "info.circle")} size={15} color={color} /></View>
    <Text selectable style={{ ...type.footnote, flex: 1, lineHeight: 19, color }}>{children}</Text>
  </View>;
}

const PULSE = { from: { opacity: 1, transform: [{ scale: 1 }] }, "50%": { opacity: 0.35, transform: [{ scale: 0.8 }] }, to: { opacity: 1, transform: [{ scale: 1 }] } };
/** Status dot; `pulse` breathes it (1.6 s) while something is live. Hollow for provisional text. */
export function Dot({ color, pulse = false, hollow = false }: { color: string; pulse?: boolean; hollow?: boolean }) {
  return <Animated.View style={{ width: 8, height: 8, borderRadius: 4, borderWidth: hollow ? 1.5 : 0, borderColor: color, backgroundColor: hollow ? "transparent" : color, animationName: pulse ? PULSE : undefined, animationDuration: 1600, animationIterationCount: "infinite", animationTimingFunction: "ease-in-out" }} />;
}

export const noteMeta: Record<keyof NoteSections, { title: string; icon: string }> = {
  subjective: { title: "Consultation & history", icon: "text.bubble" },
  objective: { title: "Observations", icon: "waveform.path.ecg" },
  assessment: { title: "Clinician assessment", icon: "stethoscope" },
  plan: { title: "Plan", icon: "list.bullet.clipboard" },
};

export const fieldStyle = { ...type.body, backgroundColor: "rgba(20,28,40,0.04)", borderRadius: radius.control, borderCurve: "continuous", paddingHorizontal: 14, paddingVertical: 12, minHeight: 46, color: palette.ink } as const;
