import { Canvas, Circle, RadialGradient, vec } from "@shopify/react-native-skia";
import { useEffect } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import Animated, { cancelAnimation, Easing, type SharedValue, useDerivedValue, useFrameCallback, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useReduceMotionPreference } from "./accessibility";
import { useVisible } from "./use-visible";

// Soft light pools: ice blue, teal and periwinkle replace Monogram's pastel pink wash.
const pools = [
  { x: 0.05, y: 0.42, r: 0.95, color: "rgba(196,236,238,0.75)", dx: 0.06, dy: 0.05 },
  { x: 0.95, y: 0.34, r: 0.85, color: "rgba(214,221,252,0.85)", dx: -0.05, dy: 0.06 },
  { x: 0.55, y: 0.98, r: 0.9, color: "rgba(205,224,252,0.8)", dx: 0.04, dy: -0.04 },
  { x: 0.2, y: 0.02, r: 0.7, color: "rgba(226,238,255,0.9)", dx: 0.05, dy: 0.03 },
];

function Pool({ pool, width, height, drift }: { pool: (typeof pools)[number]; width: number; height: number; drift: SharedValue<number> }) {
  const center = useDerivedValue(() => vec((pool.x + pool.dx * drift.value) * width, (pool.y + pool.dy * drift.value) * height));
  const radius = pool.r * Math.max(width, height) * 0.62;
  return <Circle c={center} r={radius}><RadialGradient c={center} r={radius} colors={[pool.color, "rgba(255,255,255,0)"]} /></Circle>;
}

/** Full-bleed light wash. `thinking` adds the Monogram pulse sweep from the upper left. */
export function AmbientWash({ quiet = false, thinking = false }: { quiet?: boolean; thinking?: boolean }) {
  const { width, height } = useWindowDimensions();
  const reduced = useReduceMotionPreference();
  const visible = useVisible();
  const drift = useSharedValue(0), pulse = useSharedValue(0), elapsed = useSharedValue(0), pending = useSharedValue(0);
  // Skia redraws the full-screen wash whenever drift changes. The drift is a slow 9 s sway, so it steps 15 times a
  // second rather than every frame (a withRepeat redrew it 60–120 times a second), and stops while nobody can see it.
  const sway = useFrameCallback(f => {
    pending.value += f.timeSincePreviousFrame ?? 0;
    if (pending.value < 1000 / 15) return;
    elapsed.value += pending.value; pending.value = 0;
    drift.value = (1 - Math.cos((elapsed.value / 9000) * Math.PI)) / 2;
  }, false);
  useEffect(() => {
    if (reduced) drift.set(0);
    sway.setActive(visible && !reduced);
    return () => sway.setActive(false);
  }, [reduced, visible]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!visible) { cancelAnimation(pulse); return; }
    pulse.set(thinking ? (reduced ? 0.5 : withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.sin) }), -1, true)) : withTiming(0, { duration: 350 }));
  }, [thinking, reduced, visible, pulse]);
  const glowCenter = vec(width * 0.28, height * 0.2);
  const glowRadius = useDerivedValue(() => 150 + pulse.value * 60);
  const glowOpacity = useDerivedValue(() => (thinking ? 0.55 + pulse.value * 0.45 : pulse.value));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: quiet ? 0.8 : 1, transitionProperty: "opacity", transitionDuration: 500 }]}>
    <Canvas style={StyleSheet.absoluteFill}>
      {pools.map((pool, i) => <Pool key={i} pool={pool} width={width} height={height} drift={drift} />)}
      <Circle c={glowCenter} r={glowRadius} opacity={glowOpacity}><RadialGradient c={glowCenter} r={210} colors={["rgba(120,168,255,0.42)", "rgba(150,196,255,0.22)", "rgba(255,255,255,0)"]} /></Circle>
    </Canvas>
  </Animated.View>;
}
