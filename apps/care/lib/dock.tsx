import { BlurView } from "expo-blur";
import { router, usePathname } from "expo-router";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { useMe } from "@/features/me";
import { orbPad, SonaOrb } from "./orb";
import { palette } from "./theme";

/**
 * The bottom bar (the AI Health Companion kit's navbar): a frosted glass pill with the four places a
 * patient goes (home, schedule, medicine, doctors) and, apart from it on the right, the Sona orb, which
 * opens Ask Sona Care. The white glass circle behind the current tab slides to a new tab on a spring and
 * stretches as it travels (after Kann's tab indicator), settling round. Shown on those four screens once
 * the patient has linked their record; screens under it keep `DOCK_SPACE` of bottom padding.
 */
export const DOCK_SPACE = 120;
const TABS = [
  { path: "/", label: "Home", d: "m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10" },
  { path: "/follow-ups", label: "Schedule", d: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2" },
  { path: "/dose", label: "Medicine", d: "m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7ZM8.5 8.5l7 7" },
  { path: "/doctors", label: "Doctors", d: "M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3M8 15v1a6 6 0 0 0 6 6a6 6 0 0 0 6-6v-4M20 10a2 2 0 1 0 0 4a2 2 0 0 0 0-4" },
] as const;
const TAB = 56, PAD = 4, ORB = 56;

export function Dock() {
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const still = useReducedMotion();
  const { state } = useMe();
  const at = TABS.findIndex(t => t.path === path);
  const x = useSharedValue(Math.max(0, at) * TAB);
  const stretch = useSharedValue(1);
  useEffect(() => {
    if (at < 0) return;
    if (still) { x.set(at * TAB); return; }
    x.set(withSpring(at * TAB, { duration: 420, dampingRatio: 0.82 }));
    stretch.set(withSequence(withTiming(1.3, { duration: 130 }), withSpring(1, { duration: 380, dampingRatio: 0.7 })));
  }, [at, still, x, stretch]);
  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { scaleX: stretch.value }] }));
  if (state !== "joined" || at < 0) return null;

  return <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(120)} pointerEvents="box-none"
    style={{ position: "absolute", left: 20, right: 20, bottom: Math.max(insets.bottom, 12) + 2, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
    <View style={{ borderRadius: 999, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.9)", boxShadow: "0 14px 30px -16px rgba(80,60,140,0.45)" }}>
      <BlurView accessibilityRole="tablist" intensity={60} tint="light" style={{ flexDirection: "row", padding: PAD, backgroundColor: "rgba(255,255,255,0.62)" }}>
        <Animated.View pointerEvents="none" style={[{ position: "absolute", left: PAD, top: PAD, width: TAB, height: TAB, borderRadius: TAB / 2, backgroundColor: palette.white, boxShadow: "0 6px 14px -8px rgba(40,50,110,0.4)" }, indicator]} />
        {TABS.map((t, i) => {
          const on = i === at;
          return <Pressable key={t.path} accessibilityRole="tab" accessibilityLabel={t.label} accessibilityState={{ selected: on }} onPress={() => { if (!on) router.navigate(t.path); }}
            style={({ pressed }) => ({ width: TAB, height: TAB, alignItems: "center", justifyContent: "center", transform: [{ scale: pressed ? 0.92 : 1 }] })}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill={on && i === 0 ? palette.ink : "none"} stroke={on ? palette.ink : palette.faint} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><Path d={t.d} /></Svg>
          </Pressable>;
        })}
      </BlurView>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Ask Sona Care" accessibilityHint="Quick answers from your discharge plan" onPress={() => router.push("/assistant")}
      style={({ pressed }) => ({ width: ORB + 10, height: ORB + 10, borderRadius: (ORB + 10) / 2, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.6)", borderWidth: 1, borderColor: "rgba(255,255,255,0.9)", transform: [{ scale: pressed ? 0.94 : 1 }] })}>
      <View pointerEvents="none" style={{ margin: -orbPad(ORB) }}><SonaOrb size={ORB} lift={false} /></View>
    </Pressable>
  </Animated.View>;
}
