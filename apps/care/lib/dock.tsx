import { BlurView } from "expo-blur";
import { router, usePathname } from "expo-router";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { useRevealed } from "@/features/opening";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMe } from "@/features/me";
import { useMessageNeeds } from "@/features/messages/row";
import { useT } from "./i18n";
import { Icon } from "./icons";
import { orbPad, SonaOrb } from "./orb";
import "./strings";
import { palette } from "./theme";

/**
 * The bottom bar (the AI Health Companion kit's navbar): a frosted glass pill with the places a
 * patient goes (home, schedule, medicine, doctors, messages) and, apart from it on the right, the Sona orb, which
 * opens Ask Sona Care. The white glass circle behind the current tab slides to a new tab on a spring and
 * stretches as it travels (after Kann's tab indicator), settling round. Shown on those four screens once
 * the patient has linked their record; screens under it keep `DOCK_SPACE` of bottom padding.
 */
export const DOCK_SPACE = 120;
const TABS = [
  { path: "/", label: "dock.home", icon: "home" },
  { path: "/follow-ups", label: "dock.schedule", icon: "calendar" },
  { path: "/dose", label: "dock.medicine", icon: "pill" },
  { path: "/doctors", label: "dock.doctors", icon: "doctor" },
] as const;
// Messages sits last in the pill but opens the thread over the dock (its composer needs the bottom edge), so it is never the current tab.
// Five 50 pt keys + pad (260) and the 66 pt orb fit 335 pt, the narrowest phone less its 20 pt gutters; every key stays over 44 pt.
const TAB = 50, PAD = 4, ORB = 56;

let arrived = false;

export function Dock() {
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const still = useReducedMotion();
  const { state } = useMe();
  const revealed = useRevealed();
  const tr = useT();
  const unread = useMessageNeeds() > 0;
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
  // It arrives with the opening's reveal, never over Sona while the app is still opening.
  const shown = state === "joined" && at >= 0 && revealed;
  useEffect(() => { if (shown) arrived = true; }, [shown]);
  if (!shown) return null;

  // The first time, it arrives with the opening's slow reveal; after that (back from a page) on the stack's 250 ms crossfade.
  const arrive = arrived ? FadeIn.duration(250) : FadeIn.duration(560).easing(Easing.inOut(Easing.cubic));
  return <Animated.View entering={still ? undefined : arrive} exiting={FadeOut.duration(120)} pointerEvents="box-none"
    style={{ position: "absolute", left: 20, right: 20, bottom: Math.max(insets.bottom, 12) + 2, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
    <View style={{ borderRadius: 999, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.9)", boxShadow: "0 14px 30px -16px rgba(80,60,140,0.45)" }}>
      <BlurView accessibilityRole="tablist" intensity={60} tint="light" style={{ flexDirection: "row", padding: PAD, backgroundColor: "rgba(255,255,255,0.62)" }}>
        <Animated.View pointerEvents="none" style={[{ position: "absolute", left: PAD, top: PAD, width: TAB, height: TAB, borderRadius: TAB / 2, backgroundColor: palette.white, boxShadow: "0 6px 14px -8px rgba(40,50,110,0.4)" }, indicator]} />
        {TABS.map((t, i) => {
          const on = i === at;
          return <Pressable key={t.path} accessibilityRole="tab" accessibilityLabel={tr(t.label)} accessibilityState={{ selected: on }} onPress={() => { if (!on) router.navigate(t.path); }}
            style={({ pressed }) => ({ width: TAB, height: TAB, alignItems: "center", justifyContent: "center", transform: [{ scale: pressed ? 0.92 : 1 }] })}>
            {/* The current tab is filled, so it reads by shape as well as colour. */}
            <Icon name={t.icon} color={on ? palette.ink : palette.faint} weight={on ? "fill" : "regular"} />
          </Pressable>;
        })}
        {/* A small blue dot while the care team's reply is unopened; VoiceOver says it in the label. */}
        <Pressable accessibilityRole="button" accessibilityLabel={tr(unread ? "dock.messagesNew" : "dock.messages")} onPress={() => router.push("/messages")}
          style={({ pressed }) => ({ width: TAB, height: TAB, alignItems: "center", justifyContent: "center", transform: [{ scale: pressed ? 0.92 : 1 }] })}>
          <Icon name="chat" color={palette.faint} />
          {unread && <Animated.View entering={still ? undefined : FadeIn.duration(200)} pointerEvents="none"
            style={{ position: "absolute", top: 12, right: 11, width: 10, height: 10, borderRadius: 5, backgroundColor: palette.info, borderWidth: 2, borderColor: palette.white }} />}
        </Pressable>
      </BlurView>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={tr("dock.ask")} accessibilityHint={tr("dock.askHint")} onPress={() => router.push("/assistant")}
      style={({ pressed }) => ({ width: ORB + 10, height: ORB + 10, borderRadius: (ORB + 10) / 2, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.6)", borderWidth: 1, borderColor: "rgba(255,255,255,0.9)", transform: [{ scale: pressed ? 0.94 : 1 }] })}>
      <View pointerEvents="none" style={{ margin: -orbPad(ORB) }}><SonaOrb size={ORB} lift={false} /></View>
    </Pressable>
  </Animated.View>;
}
