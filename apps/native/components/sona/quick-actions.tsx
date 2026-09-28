import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { HalftoneGlint, HalftoneShimmer } from "./halftone-shimmer";
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
export type QuickTone = "urgent" | "caution" | "good" | "calm";
export type QuickAction = { key: string; label: string; icon: string; status: string; tone?: QuickTone; badge?: number; onPress: () => void };
const INK: Record<QuickTone, string> = { urgent: palette.red, caution: palette.amber, good: "#0F6E66", calm: palette.muted };
// The glyph's disc says the key's state, the same colours as everywhere else: red act now, amber needs
// attention, teal ready, blue nothing pending. Colour always means something, so calm keys stay brand blue.
const DISC: Record<QuickTone, { fill: string; glow: string; tint: [number, number, number] }> = {
  urgent: { fill: palette.red, glow: "rgba(162,62,62,0.3)", tint: [0.86, 0.42, 0.42] },
  caution: { fill: "#B7741E", glow: "rgba(183,116,30,0.3)", tint: [0.92, 0.66, 0.34] },
  good: { fill: "#0F6E66", glow: "rgba(15,110,102,0.3)", tint: [0.36, 0.74, 0.68] },
  calm: { fill: palette.blue, glow: "rgba(36,91,204,0.3)", tint: [0.42, 0.62, 0.95] },
};
// Each key keeps its own dither corner and grain (fixed by position, never random per render), so the
// shelf reads as four distinct keys under one material; the grain takes the key's state colour.
const DITHER: { corner: "tr" | "bl" | "tl" | "br"; pitch: number }[] = [{ corner: "tr", pitch: 3.5 }, { corner: "bl", pitch: 3 }, { corner: "tl", pitch: 4 }, { corner: "br", pitch: 3.2 }];
const tap = () => { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); };

/*
 * Keys, not segments: each action is a raised liquid-glass key so it reads as pressable before it
 * is touched. A bright top edge and a 2 pt shadow ledge give it height; pressing sinks it 2 pt and
 * flattens the ledge (after Duolingo's tactile button), the glyph pulses like a droplet, one haptic.
 * On first appearance a halftone shimmer sweeps across the keys once, 120 ms apart (after Queue's
 * update-button shimmer: ease-in-out, 1.1 s), so the shelf announces itself without looping.
 */
const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);
/** `wide`: the odd key out spans the row, so the shelf never ends on a half-empty line. */
function Key({ a, index, shimmer, wide = false }: { a: QuickAction; index: number; shimmer: boolean; wide?: boolean }) {
  const { reducedMotion, reducedTransparency } = useAccessibleEffects();
  const { width } = useWindowDimensions();
  const keyW = wide ? width - 40 : (width - 40 - 10) / 2;
  const down = useSharedValue(0), pulse = useSharedValue(1), sweep = useSharedValue(0);
  useEffect(() => { if (shimmer && !reducedMotion) sweep.set(withDelay(500 + index * 120, withTiming(1, { duration: 1100, easing: EASE_IN_OUT }))); }, [shimmer, reducedMotion, index, sweep]);
  const urgent = a.tone === "urgent";
  const disc = DISC[a.tone ?? "calm"], dither = DITHER[index % DITHER.length]!;
  const key = useAnimatedStyle(() => ({ transform: [{ translateY: down.value * 2 }], boxShadow: `0 ${2 - down.value * 2}px 0 rgba(40,70,140,${0.14 - down.value * 0.1}), 0 ${8 - down.value * 6}px ${18 - down.value * 10}px rgba(40,70,140,0.10)` }));
  const glyph = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  return <Animated.View style={[{ width: keyW, borderRadius: 24, borderCurve: "continuous" }, key]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${a.label}. ${a.status}`}
      onPressIn={() => { down.set(withTiming(1, { duration: 70 })); if (!reducedMotion) pulse.set(withTiming(0.88, { duration: 90 })); }}
      onPressOut={() => { down.set(withSpring(0, { duration: 260, dampingRatio: 0.6 })); pulse.set(reducedMotion ? 1 : withSpring(1, { duration: 320, dampingRatio: 0.55 })); }}
      onPress={() => { tap(); a.onPress(); }}>
      <Glass opaque={reducedTransparency} style={{ borderRadius: 24, borderWidth: 1, borderColor: urgent ? "rgba(162,62,62,0.22)" : "rgba(255,255,255,0.95)" }}>
        {/* The key's lit top edge. */}
        <View pointerEvents="none" style={{ position: "absolute", left: 10, right: 10, top: 0, height: 1.5, borderRadius: 1, backgroundColor: "rgba(255,255,255,0.95)" }} />
        {!reducedMotion && <View pointerEvents="none" style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: 24 }}><HalftoneShimmer width={keyW} height={104} progress={sweep} /></View>}
        <View pointerEvents="none" style={{ position: "absolute", width: 96, height: 62, [dither.corner[0] === "t" ? "top" : "bottom"]: 0, [dither.corner[1] === "r" ? "right" : "left"]: 0, overflow: "hidden", borderRadius: 24 }}>
          <HalftoneGlint width={96} height={62} origin={[dither.corner[1] === "r" ? 96 : 0, dither.corner[0] === "t" ? 0 : 62]} reach={[88, 58]} pitch={dither.pitch} strength={urgent ? 0.5 : 0.32} tint={disc.tint} hueShift={0} style={{ top: 0, left: 0 }} />
        </View>
        <View style={{ minHeight: 104, padding: 14, justifyContent: "space-between", gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
            <Animated.View style={[{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: disc.fill, boxShadow: `0 3px 8px ${disc.glow}` }, glyph]}>
              <Icon name={a.icon} size={17} color={palette.white} />
            </Animated.View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {!!a.badge && <View style={{ minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: urgent ? palette.red : a.tone === "caution" ? palette.amber : a.tone === "good" ? "#0F6E66" : "rgba(20,28,40,0.08)" }}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: urgent || a.tone === "caution" || a.tone === "good" ? palette.white : palette.ink, fontVariant: ["tabular-nums"] }}>{a.badge}</Text>
              </View>}
              <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(20,28,40,0.06)" }}><Icon name="arrow.up.right" size={10} color={palette.ink} /></View>
            </View>
          </View>
          <View style={{ gap: 1 }}>
            <Text style={{ ...type.subhead, fontWeight: "700", color: palette.ink }}>{a.label}</Text>
            <Text numberOfLines={1} style={{ ...type.caption, fontWeight: "500", color: INK[a.tone ?? "calm"] }}>{a.status}</Text>
          </View>
        </View>
      </Glass>
    </Pressable>
  </Animated.View>;
}

let shimmered = false;
export function QuickActions({ actions, animate = true }: { actions: QuickAction[]; animate?: boolean }) {
  const { reducedMotion } = useAccessibleEffects();
  // The shimmer hint plays the first time a shelf appears in a session, then never again.
  const [shimmer, setShimmer] = useState(false);
  useEffect(() => { if (animate && !shimmered) { shimmered = true; setShimmer(true); } }, [animate]);
  return <Animated.View entering={animate && !reducedMotion ? riseIn({ delay: 60, distance: 10, duration: 380 }) : undefined} style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
    {actions.map((a, i) => <Key key={a.key} a={a} index={i} shimmer={shimmer} wide={actions.length % 2 === 1 && i === actions.length - 1} />)}
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
          <Icon name={a.icon} size={15} color={DISC[a.tone ?? "calm"].fill} />
          {!!a.badge && <Text style={{ fontSize: 13, fontWeight: "700", color: urgent ? palette.red : palette.ink, fontVariant: ["tabular-nums"] }}>{a.badge}</Text>}
        </Pressable>; })}
      </View>
    </Glass>
  </Animated.View>;
}
