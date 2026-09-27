import { Blur, Canvas, Circle, Group, LinearGradient, Oval, Paint, Path, RadialGradient, Skia, SweepGradient, rect, rrect, useClock, vec } from "@shopify/react-native-skia";
import { useEffect } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useDerivedValue, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming, type SharedValue } from "react-native-reanimated";

/**
 * Sona Care's hero: a liquid-glass orb (after Wabi's "New" glass gradient button). A thin clear shell
 * with fixed reflections (a gradient rim, a top crescent glare, a bottom caustic) holds a soft core
 * whose blurred colour blobs drift on slow linear orbits under a rotating overlay sweep. Drag it and
 * the core tilts inside the fixed glass, then springs back; `roll` changing rolls it once. Still under
 * Reduce Motion. Measurements follow the shot's 82 pt orb, scaled.
 */
const BACK = { duration: 700, dampingRatio: 0.55 } as const;
// Sona's palette on the shot's four orbits: [colour, radius, orbit (fraction of size), speed rad/s, phase]
const blobs: [string, number, number, number, number][] = [
  ["rgba(36,91,204,1)", 24, 0.22, 0.7, 0], // deep blue
  ["rgba(40,190,176,0.95)", 20, 0.2, -0.5, 1.8], // teal
  ["rgba(128,90,236,0.9)", 24, 0.2, 0.4, 3.5], // lilac
  ["rgba(236,130,196,0.85)", 16, 0.17, -0.8, 0.5], // blush shimmer
];

function Blob({ spec, clock, s, k, still }: { spec: (typeof blobs)[number]; clock: SharedValue<number>; s: number; k: number; still: boolean }) {
  const [color, r, orbit, speed, phase] = spec;
  const c = useDerivedValue(() => {
    const t = still ? 0 : clock.value / 1000;
    const a = t * speed + phase;
    return vec(s / 2 + Math.cos(a) * orbit * s - Math.sin(t * 0.5) * 6 * k, s / 2 + Math.sin(a * 0.9) * orbit * s + Math.cos(t * 0.4) * 6 * k);
  });
  return <Circle c={c} r={r * k} color={color} />;
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

  const s = size, k = s / 82, pad = 14 * k, W = s + pad * 2, center = vec(s / 2, s / 2);
  const core = useDerivedValue(() => [{ translateX: tx.value * s * 0.12 }, { translateY: ty.value * s * 0.12 }]);
  const sweep = useDerivedValue(() => [{ rotate: still ? 0 : (clock.value / 1000) * 0.4 }]);
  const caustic = Skia.Path.Make();
  caustic.addArc(rect(1, 1, s - 2, s - 2), 54, 83); // SwiftUI trim 0.15–0.38: bottom right round to bottom left

  return <GestureDetector gesture={drag}>
    <View accessible accessibilityRole="image" accessibilityLabel="Sona Care" style={{ width: W, height: W }}>
      <Canvas style={{ width: W, height: W }}>
        <Group transform={[{ translateX: pad }, { translateY: pad }]}>
          {/* Soft volumetric shadow under the sphere. */}
          <Circle c={vec(s / 2, s / 2 + 6 * k)} r={s * 0.46} color="rgba(96,110,190,0.22)"><Blur blur={12 * k} /></Circle>

          <Group clip={rrect(rect(0, 0, s, s), s / 2, s / 2)}>
            {/* The liquid core: a light fill, blurred drifting blobs, an overlay sweep turning slowly. */}
            <Circle c={center} r={s / 2}><RadialGradient c={center} r={s / 2} colors={["#F7F9FE", "#E6EAF6"]} /></Circle>
            <Group transform={core} layer={<Paint><Blur blur={8 * k} /></Paint>}>
              {blobs.map((b, i) => <Blob key={i} spec={b} clock={clock} s={s} k={k} still={still} />)}
            </Group>
            <Group blendMode="overlay" layer={<Paint><Blur blur={8 * k} /></Paint>}>
              <Circle c={center} r={s / 2}>
                <SweepGradient c={center} origin={center} transform={sweep} colors={["rgba(36,91,204,0.5)", "rgba(64,196,180,0.3)", "rgba(139,104,240,0.4)", "rgba(36,91,204,0.5)"]} />
              </Circle>
            </Group>
          </Group>

          {/* The fixed glass shell. */}
          <Circle c={center} r={s / 2 - 0.75 * k} style="stroke" strokeWidth={1.5 * k}>
            <LinearGradient start={vec(0, 0)} end={vec(s, s)} colors={["rgba(255,255,255,0.85)", "rgba(255,255,255,0.2)", "rgba(0,0,0,0.12)", "rgba(255,255,255,0.5)"]} />
          </Circle>
          <Group clip={rrect(rect(0, 0, s, s), s / 2, s / 2)} layer={<Paint><Blur blur={1.5 * k} /></Paint>}>
            <Oval x={s / 2 - 29 * k} y={2 * k} width={58 * k} height={30 * k}>
              <LinearGradient start={vec(0, 2 * k)} end={vec(0, 32 * k)} colors={["rgba(255,255,255,0.95)", "rgba(255,255,255,0.25)", "rgba(255,255,255,0)"]} />
            </Oval>
          </Group>
          <Path path={caustic} style="stroke" strokeWidth={2 * k} strokeCap="round">
            <LinearGradient start={vec(0, s)} end={vec(0, s * 0.6)} colors={["rgba(255,255,255,0.9)", "rgba(255,255,255,0)"]} />
          </Path>
        </Group>
      </Canvas>
    </View>
  </GestureDetector>;
}
