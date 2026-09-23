import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";
import { Text } from "@/components/sona/text";
import { LAYOUT } from "@/components/sona/motion";
import { palette } from "@/components/sona/theme";
import { Expand, glass, Icon, useAccessibleEffects } from "@/components/sona/ui";

const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);

export function haptic(kind: "select" | "done" = "select") {
  if (process.env.EXPO_OS !== "ios") return;
  (kind === "done" ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : Haptics.selectionAsync()).catch(() => {});
}

/** Round icon well that anchors a row (same width as the evidence icons below it, so they line up). */
export function IconDisc({ icon }: { icon: string }) {
  return <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: palette.canvas, alignItems: "center", justifyContent: "center" }}><Icon name={icon} size={17} /></View>;
}

/** An inline note: icon and muted text, no box. Boxed `Notice` stays for warnings. */
export function Caption({ icon = "info.circle", color = palette.muted, children }: { icon?: string; color?: string; children: ReactNode }) {
  return <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
    <View style={{ paddingTop: 2 }}><Icon name={icon} size={14} color={color} /></View>
    <Text selectable style={{ flex: 1, fontSize: 13, lineHeight: 19, color: palette.muted }}>{children}</Text>
  </View>;
}

/**
 * A row inside a surface that opens in place (after CRED's policy-card unstack): the header
 * presses to 0.98, its chevron turns on a 240 ms ease-out, the body unfolds with `Expand` on the
 * layout spring and every row below glides on the same spring.
 */
export function Disclosure({ icon, title, detail, open, onToggle, first = false, accessibilityLabel, accessibilityHint, children }: {
  icon: string; title: string; detail?: string; open: boolean; onToggle: () => void; first?: boolean;
  accessibilityLabel?: string; accessibilityHint?: string; children: ReactNode;
}) {
  const { reducedMotion } = useAccessibleEffects();
  return <Animated.View layout={reducedMotion ? undefined : LAYOUT} style={first ? undefined : { borderTopWidth: 1, borderColor: glass.hairline }}>
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? (detail ? `${title}. ${detail}` : title)} accessibilityHint={accessibilityHint} accessibilityState={{ expanded: open }}
      onPress={() => { haptic(); onToggle(); }}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: detail ? "flex-start" : "center", gap: 12, paddingVertical: 14, transform: [{ scale: pressed ? 0.98 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
      <IconDisc icon={icon} />
      <View style={{ flex: 1, gap: 2, paddingTop: detail ? 1 : 0 }}>
        <Text style={{ fontSize: 16, lineHeight: 22, fontWeight: "600", color: palette.ink }}>{title}</Text>
        {detail && <Text style={{ fontSize: 14, lineHeight: 20, color: palette.muted }}>{detail}</Text>}
      </View>
      <View style={{ paddingTop: detail ? 4 : 0 }}>
        <Animated.View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }], transitionProperty: "transform", transitionDuration: reducedMotion ? 0 : 240, transitionTimingFunction: EASE_OUT }}>
          <Icon name="chevron.down" size={14} color={palette.muted} />
        </Animated.View>
      </View>
    </Pressable>
    {open && <Expand style={{ gap: 16, paddingBottom: 18 }}>{children}</Expand>}
  </Animated.View>;
}
