import { Image } from "expo-image";
import { useEffect, useState, useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Text } from "./text";
import { palette } from "./theme";
import { canvasImage, useAccessibleEffects } from "./ui";
import { EASE_IN_OUT, EASE_OUT } from "./motion";

/*
 * Opening Sona Pro (after 60fps "Clay Splash", https://60fps.design/shots/clay-splash, and "Medium Splash",
 * https://60fps.design/shots/medium-splash): on a cold start Home waits under one calm layer, the Sona mark centred
 * on the canvas, until it knows what to show (the live choice read and, when live, the day's data in), so nothing
 * pops in or swaps after it appears. Then the mark steps toward you (1 → 1.15) and fades on a fast ease-out while the
 * layer clears, and Home's ranked rows rise in one after another underneath. At most 4 s, then it opens anyway.
 * Once per launch; Reduce Motion: a short fade, no scale.
 */
const ICON = require("../../assets/images/icon.png");
const HOLD = 4000;

let opened = false;
const listeners = new Set<() => void>();
const open = () => { if (!opened) { opened = true; listeners.forEach(l => l()); } };
/** Whether the opening has lifted (always true after the first launch), so Home's rows can rise in where they are seen. */
export const useOpened = () => useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => opened);

export function Opening({ ready }: { ready: boolean }) {
  const { reducedMotion } = useAccessibleEffects();
  const [shown, setShown] = useState(!opened);
  const [held, setHeld] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setHeld(true), HOLD); return () => clearTimeout(timer); }, []);
  const go = ready || held;
  const veil = useSharedValue(1), mark = useSharedValue(1), breath = useSharedValue(0);

  // While waiting, the mark breathes very slightly so the wait reads as alive, not frozen.
  useEffect(() => {
    if (reducedMotion || go) return;
    breath.set(withRepeat(withSequence(withTiming(1, { duration: 900, easing: EASE_IN_OUT }), withTiming(0, { duration: 900, easing: EASE_IN_OUT })), -1));
  }, [reducedMotion, go, breath]);

  useEffect(() => {
    if (!go || !shown) return;
    open();
    const done = (finished?: boolean) => { "worklet"; if (finished) scheduleOnRN(setShown, false); };
    breath.set(withTiming(0, { duration: 160 }));
    if (reducedMotion) { veil.set(withTiming(0, { duration: 220 }, done)); return; }
    mark.set(withTiming(0, { duration: 420, easing: EASE_OUT }));
    veil.set(withDelay(120, withTiming(0, { duration: 420, easing: EASE_OUT }, done)));
  }, [go]); // eslint-disable-line react-hooks/exhaustive-deps

  const veilStyle = useAnimatedStyle(() => ({ opacity: veil.value }));
  const markStyle = useAnimatedStyle(() => ({
    opacity: mark.value,
    transform: [{ scale: reducedMotion ? 1 : (1 + 0.15 * (1 - mark.value)) * (1 + 0.02 * breath.value) }],
  }));
  if (!shown) return null;
  return <Animated.View pointerEvents={go ? "none" : "auto"} accessible accessibilityLabel="Sona Pro is opening" style={[StyleSheet.absoluteFill, { zIndex: 50, backgroundColor: palette.canvas, experimental_backgroundImage: canvasImage, alignItems: "center", justifyContent: "center" }, veilStyle]}>
    <Animated.View style={[{ alignItems: "center", gap: 14 }, markStyle]}>
      <View style={{ width: 96, height: 96, borderRadius: 24, borderCurve: "continuous", overflow: "hidden", boxShadow: "0 14px 30px -14px rgba(36,91,204,0.45)" }}>
        <Image source={ICON} style={{ width: 96, height: 96 }} />
      </View>
      <Text style={{ fontSize: 17, lineHeight: 22, fontWeight: "600", letterSpacing: -0.2, color: palette.ink }}>Sona Pro</Text>
    </Animated.View>
  </Animated.View>;
}
