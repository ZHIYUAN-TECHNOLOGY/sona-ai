import { Blur, Canvas, Circle, Group, Oval, RadialGradient, Rect, rect, rrect, useClock, vec } from "@shopify/react-native-skia";
import { useEffect } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useDerivedValue, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming, type SharedValue } from "react-native-reanimated";

/**
 * Sona Care's hero: a glass marble, free of any card (after Wabi's animated glass icons). Inside, the
 * aurora swirls slowly; the marble has a refracting rim, a specular arc top left, bounce light at the
 * bottom and a soft contact shadow. Drag it and the inside tilts against the glass, then springs back;
 * `roll` changing (a step change) rolls it once. Still under Reduce Motion.
 */
const blobs = [
  { color: "rgba(36,91,204,1)", orbit: 0.26, period: 7, phase: 0 },
  { color: "rgba(139,104,240,1)", orbit: 0.3, period: 9, phase: 2.1 },
  { color: "rgba(64,196,180,1)", orbit: 0.28, period: 11, phase: 4.2 },
  { color: "rgba(236,120,196,0.95)", orbit: 0.24, period: 13, phase: 1.1 },
  { color: "rgba(214,236,255,0.9)", orbit: 0.2, period: 17, phase: 3.3 }, // a pale current, so it reads as light, not paint
];
const BACK = { duration: 700, dampingRatio: 0.55 } as const; // a subtle overshoot as the inside settles

function Blob({ b, clock, size, still }: { b: (typeof blobs)[number]; clock: SharedValue<number>; size: number; still: boolean }) {
  const r = size * 0.46;
  const c = useDerivedValue(() => {
    const t = still ? b.phase : (clock.value / 1000) * (2 * Math.PI) / b.period + b.phase;
    return vec(size / 2 + Math.cos(t) * b.orbit * size, size / 2 + Math.sin(t * 1.3) * b.orbit * size);
  });
  return <Circle c={c} r={r}><RadialGradient c={c} r={r} colors={[b.color, b.color.replace(/[\d.]+\)$/, "0)")]} /></Circle>;
}

export function HeroOrb({ size = 148, roll }: { size?: number; roll?: unknown }) {
  const clock = useClock();
  const still = useReducedMotion();
  const tx = useSharedValue(0), ty = useSharedValue(0);

  useEffect(() => {
    if (still || roll === undefined) return;
    tx.set(withSequence(withTiming(0.7, { duration: 220 }), withSpring(0, BACK)));
    ty.set(withSequence(withTiming(-0.35, { duration: 220 }), withSpring(0, BACK)));
  }, [roll, still, tx, ty]);

  const drag = Gesture.Pan().enabled(!still)
    .onChange(e => { tx.set(Math.max(-1, Math.min(1, e.translationX / 90))); ty.set(Math.max(-1, Math.min(1, e.translationY / 90))); })
    .onFinalize(() => { tx.set(withSpring(0, BACK)); ty.set(withSpring(0, BACK)); });

  // The inside moves with the tilt and turns slowly; the highlight slides the other way, selling the depth.
  const inside = useDerivedValue(() => [
    { translateX: tx.value * size * 0.14 }, { translateY: ty.value * size * 0.14 },
    { rotate: (still ? 0 : clock.value / 9000) + tx.value * 0.5 },
  ]);
  const shine = useDerivedValue(() => [{ translateX: -tx.value * size * 0.05 }, { translateY: -ty.value * size * 0.05 }]);

  const s = size, h = size * 1.14, center = vec(s / 2, s / 2);
  return <GestureDetector gesture={drag}>
    <View accessible accessibilityRole="image" accessibilityLabel="Sona Care" style={{ width: s, height: h }}>
      <Canvas style={{ width: s, height: h }}>
        <Oval x={s * 0.2} y={s * 1.0} width={s * 0.6} height={s * 0.09} color="rgba(40,70,160,0.3)"><Blur blur={7} /></Oval>
        <Group clip={rrect(rect(0, 0, s, s), s / 2, s / 2)}>
          <Rect x={0} y={0} width={s} height={s} color="#5F86E6" />
          <Group transform={inside} origin={center}>
            {blobs.map((b, i) => <Blob key={i} b={b} clock={clock} size={s} still={still} />)}
          </Group>
          {/* Refraction: the glass thickens toward the rim, darkening, then catches a bright edge. */}
          <Circle c={center} r={s / 2}>
            <RadialGradient c={center} r={s / 2} colors={["rgba(255,255,255,0)", "rgba(255,255,255,0)", "rgba(20,36,96,0.3)", "rgba(255,255,255,0.8)"]} positions={[0, 0.62, 0.9, 1]} />
          </Circle>
          {/* Bounce light off the bottom inside of the glass. */}
          <Circle c={vec(s / 2, s * 1.02)} r={s * 0.5}>
            <RadialGradient c={vec(s / 2, s * 1.02)} r={s * 0.5} colors={["rgba(255,255,255,0.38)", "rgba(255,255,255,0)"]} />
          </Circle>
          <Group transform={shine}>
            <Oval x={s * 0.18} y={s * 0.08} width={s * 0.46} height={s * 0.24} color="rgba(255,255,255,0.55)"><Blur blur={5} /></Oval>
            <Oval x={s * 0.26} y={s * 0.12} width={s * 0.16} height={s * 0.07} color="rgba(255,255,255,0.95)"><Blur blur={1.5} /></Oval>
          </Group>
        </Group>
        <Circle c={center} r={s / 2 - 0.5} style="stroke" strokeWidth={1} color="rgba(255,255,255,0.8)" />
      </Canvas>
    </View>
  </GestureDetector>;
}
