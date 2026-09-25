import * as Haptics from "expo-haptics";
import { Pressable, View } from "react-native";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { HalftoneGlint } from "./halftone-shimmer";
import { riseIn } from "./motion";
import { Text } from "./text";
import { palette, type } from "./theme";
import { Glass, Icon, useAccessibleEffects } from "./ui";

/**
 * Quick actions as one liquid-glass shelf: four segments split by hairlines, each a blue glyph, a
 * label and a one-line muted status, so the shelf answers "does anything need me?" at a glance.
 * Only urgent segments speak up: a small red count and a faint halftone glint in their corner
 * (the brand's dithering, used as the "look here" cue). A press swells the glyph like a droplet
 * and settles back (after Quartr's liquid glass pulse: dip to 0.9, spring to 1 with a slight
 * overshoot, 0.32 s at damping 0.55), with a soft glow and one haptic. `QuickRow` is the shelf
 * flattened into a slim glass capsule of glyphs and counts, sticky once the shelf scrolls away.
 */
export type QuickTone = "urgent" | "caution" | "calm";
export type QuickAction = { key: string; label: string; icon: string; status: string; tone?: QuickTone; badge?: number; onPress: () => void };
const INK: Record<QuickTone, string> = { urgent: palette.red, caution: palette.amber, calm: palette.muted };
const HAIR = "rgba(20,28,40,0.07)";
const tap = () => { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); };

function Segment({ a, right, bottom }: { a: QuickAction; right: boolean; bottom: boolean }) {
  const { reducedMotion } = useAccessibleEffects();
  const pulse = useSharedValue(1), glow = useSharedValue(0);
  const press = () => {
    tap();
    if (!reducedMotion) {
      pulse.set(withSequence(withTiming(0.9, { duration: 90 }), withSpring(1, { duration: 320, dampingRatio: 0.55 })));
      glow.set(withSequence(withTiming(1, { duration: 90 }), withTiming(0, { duration: 420 })));
    }
    a.onPress();
  };
  const glyph = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  const halo = useAnimatedStyle(() => ({ opacity: glow.value * 0.9, transform: [{ scale: 0.8 + glow.value * 0.6 }] }));
  const urgent = a.tone === "urgent";
  return <Pressable accessibilityRole="button" accessibilityLabel={`${a.label}. ${a.status}`} onPress={press}
    style={({ pressed }) => ({ width: "50%", minHeight: 92, paddingHorizontal: 14, paddingVertical: 13, gap: 8, borderRightWidth: right ? 0 : 1, borderBottomWidth: bottom ? 0 : 1, borderColor: HAIR, backgroundColor: pressed ? "rgba(255,255,255,0.35)" : "transparent" })}>
    {urgent && <View pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, width: 90, height: 60 }}><HalftoneGlint width={90} height={60} origin={[90, 0]} reach={[84, 56]} pitch={3.5} strength={0.55} tint={[0.86, 0.42, 0.42]} hueShift={0} style={{ top: 0, left: 0 }} /></View>}
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ width: 30, height: 30, alignItems: "center", justifyContent: "center" }}>
        <Animated.View pointerEvents="none" style={[{ position: "absolute", width: 30, height: 30, borderRadius: 15, backgroundColor: urgent ? "rgba(162,62,62,0.16)" : "rgba(36,91,204,0.16)" }, halo]} />
        <Animated.View style={glyph}><Icon name={a.icon} size={17} color={urgent ? palette.red : palette.blue} /></Animated.View>
      </View>
      <Text style={{ flex: 1, ...type.subhead, fontWeight: "600", color: palette.ink }}>{a.label}</Text>
      {urgent && !!a.badge && <View style={{ minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: palette.red }}>
        <Text style={{ fontSize: 11, fontWeight: "700", color: palette.white, fontVariant: ["tabular-nums"] }}>{a.badge}</Text>
      </View>}
    </View>
    <Text numberOfLines={2} style={{ ...type.caption, fontWeight: "500", color: INK[a.tone ?? "calm"] }}>{a.status}</Text>
  </Pressable>;
}

export function QuickActions({ actions, animate = true }: { actions: QuickAction[]; animate?: boolean }) {
  const { reducedMotion } = useAccessibleEffects();
  return <Animated.View entering={animate && !reducedMotion ? riseIn({ delay: 60, distance: 10, duration: 380 }) : undefined}>
    <Glass style={{ borderRadius: 26, boxShadow: "0 8px 24px rgba(40,70,140,0.08)" }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {actions.map((a, i) => <Segment key={a.key} a={a} right={i % 2 === 1} bottom={i >= actions.length - 2} />)}
      </View>
    </Glass>
  </Animated.View>;
}

/** The shelf flattened: a slim glass capsule of glyphs with counts, fading in past `from` pt of scroll. */
export function QuickRow({ actions, scroll, from, top }: { actions: QuickAction[]; scroll: SharedValue<number>; from: number; top: number }) {
  const { reducedMotion } = useAccessibleEffects();
  const style = useAnimatedStyle(() => {
    const p = interpolate(scroll.value, [from, from + 40], [0, 1], "clamp");
    return { opacity: p, transform: [{ translateY: reducedMotion ? 0 : (1 - p) * -8 }, { scale: reducedMotion ? 1 : 0.94 + 0.06 * p }] };
  });
  const pointer = useAnimatedStyle(() => ({ pointerEvents: scroll.value > from + 30 ? "box-none" : "none" }) as never);
  return <Animated.View style={[{ position: "absolute", left: 0, right: 0, top, zIndex: 3, alignItems: "center" }, style, pointer]}>
    <Glass style={{ borderRadius: 22, boxShadow: "0 6px 18px rgba(40,70,140,0.12)" }}>
      {/* Frost over the glass: the shelf it replaces often sits right behind it. */}
      <View pointerEvents="none" style={{ position: "absolute", inset: 0, backgroundColor: "rgba(248,250,253,0.86)" }} />
      <View style={{ flexDirection: "row", paddingHorizontal: 6, paddingVertical: 5, gap: 2 }}>
        {actions.map(a => { const urgent = a.tone === "urgent"; return <Pressable key={a.key} accessibilityRole="button" accessibilityLabel={`${a.label}. ${a.status}`} onPress={() => { tap(); a.onPress(); }}
          style={({ pressed }) => ({ height: 34, minWidth: 52, paddingHorizontal: 12, borderRadius: 17, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: pressed ? "rgba(255,255,255,0.5)" : "transparent" })}>
          <Icon name={a.icon} size={15} color={urgent ? palette.red : palette.blue} />
          {!!a.badge && <Text style={{ fontSize: 13, fontWeight: "700", color: urgent ? palette.red : palette.ink, fontVariant: ["tabular-nums"] }}>{a.badge}</Text>}
        </Pressable>; })}
      </View>
    </Glass>
  </Animated.View>;
}
