import * as Haptics from "expo-haptics";
import { Pressable, View } from "react-native";
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { riseIn } from "./motion";
import { Text } from "./text";
import { palette, type } from "./theme";
import { Icon, useAccessibleEffects } from "./ui";

/**
 * Quick actions (after District's category grid that morphs into tabs): the actions a screen
 * offers, each with a live status so the tile answers "does this need me?" before it is tapped.
 * `QuickActions` is the 2×2 grid; `QuickRow` is its compact form, a sticky row that takes over as
 * the grid scrolls away (driven by scroll offset on the UI thread, no state per frame).
 */
export type QuickTone = "urgent" | "caution" | "calm";
export type QuickAction = { key: string; label: string; icon: string; status: string; tone?: QuickTone; badge?: number; onPress: () => void };
const TONE: Record<QuickTone, { ink: string; wash: string; icon: string }> = {
  urgent: { ink: palette.red, wash: "rgba(162,62,62,0.10)", icon: palette.red },
  caution: { ink: palette.amber, wash: "rgba(196,120,20,0.13)", icon: palette.amber },
  calm: { ink: palette.muted, wash: "rgba(36,91,204,0.10)", icon: palette.blue },
};
const tap = () => { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); };

export function QuickActions({ actions, animate = true }: { actions: QuickAction[]; animate?: boolean }) {
  const { reducedMotion } = useAccessibleEffects();
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
    {actions.map((a, i) => { const t = TONE[a.tone ?? "calm"]; return <Animated.View key={a.key} entering={animate && !reducedMotion ? riseIn({ delay: 60 + i * 50, distance: 10, duration: 360 }) : undefined} style={{ width: "48.4%" }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${a.label}. ${a.status}`} onPress={() => { tap(); a.onPress(); }}
        style={({ pressed }) => ({ minHeight: 88, padding: 14, gap: 10, borderRadius: 22, borderCurve: "continuous", backgroundColor: palette.white, borderWidth: 1, borderColor: a.tone === "urgent" ? "rgba(162,62,62,0.22)" : "rgba(20,28,40,0.06)", boxShadow: "0 4px 14px rgba(24,32,48,0.06)", transform: [{ scale: pressed && !reducedMotion ? 0.96 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ width: 34, height: 34, borderRadius: 11, borderCurve: "continuous", backgroundColor: t.wash, alignItems: "center", justifyContent: "center" }}><Icon name={a.icon} size={16} color={t.icon} /></View>
          {!!a.badge && <View style={{ minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: a.tone === "urgent" ? palette.red : a.tone === "caution" ? palette.amber : palette.blue }}>
            <Text style={{ fontSize: 12, fontWeight: "700", color: palette.white, fontVariant: ["tabular-nums"] }}>{a.badge}</Text>
          </View>}
        </View>
        <View style={{ gap: 1 }}>
          <Text style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>{a.label}</Text>
          <Text numberOfLines={1} style={{ ...type.caption, fontWeight: "500", color: a.tone && a.tone !== "calm" ? t.ink : palette.muted }}>{a.status}</Text>
        </View>
      </Pressable>
    </Animated.View>; })}
  </View>;
}

/** The grid's collapsed form: a sticky row of icon + label pills that fades and rises in past `from` pt of scroll. */
export function QuickRow({ actions, scroll, from, top }: { actions: QuickAction[]; scroll: SharedValue<number>; from: number; top: number }) {
  const { reducedMotion } = useAccessibleEffects();
  const style = useAnimatedStyle(() => {
    const p = interpolate(scroll.value, [from, from + 40], [0, 1], "clamp");
    return { opacity: p, transform: [{ translateY: reducedMotion ? 0 : (1 - p) * -8 }, { scale: reducedMotion ? 1 : 0.94 + 0.06 * p }] };
  });
  const pointer = useAnimatedStyle(() => ({ pointerEvents: scroll.value > from + 30 ? "box-none" : "none" }) as never);
  return <Animated.View style={[{ position: "absolute", left: 16, right: 16, top, zIndex: 3, flexDirection: "row", gap: 6, padding: 5, borderRadius: 22, backgroundColor: "#FAFBFD", borderWidth: 1, borderColor: "rgba(255,255,255,0.95)", boxShadow: "0 0 0 0.5px rgba(20,28,40,0.06), 0 6px 18px rgba(24,32,48,0.1)" }, style, pointer]}>
    {actions.map(a => { const t = TONE[a.tone ?? "calm"]; return <Pressable key={a.key} accessibilityRole="button" accessibilityLabel={`${a.label}. ${a.status}`} onPress={() => { tap(); a.onPress(); }}
      style={({ pressed }) => ({ flex: 1, height: 36, borderRadius: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: pressed ? "rgba(20,28,40,0.06)" : "transparent" })}>
      <Icon name={a.icon} size={13} color={t.icon} />
      <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "600", color: palette.ink }}>{a.label}</Text>
      {!!a.badge && <View style={{ minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: a.tone === "urgent" ? palette.red : a.tone === "caution" ? palette.amber : palette.blue }}><Text style={{ fontSize: 10, fontWeight: "700", color: palette.white }}>{a.badge}</Text></View>}
    </Pressable>; })}
  </Animated.View>;
}
