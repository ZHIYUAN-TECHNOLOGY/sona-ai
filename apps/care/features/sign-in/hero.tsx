import { Canvas, Circle, Group, RadialGradient, useClock, vec } from "@shopify/react-native-skia";
import { View } from "react-native";
import { useDerivedValue, useReducedMotion, type SharedValue } from "react-native-reanimated";
import { surfaceStyle } from "@/lib/ui";

/**
 * Sona Care's hero: a glass tile holding a soft orb whose colours slowly swirl (after mymind's
 * morphing Serendipity orb). Blue leads, with lilac, mint and blush; still under Reduce Motion.
 */
const blobs = [
  { color: "rgba(52,110,230,1)", orbit: 0.26, period: 7, phase: 0 },
  { color: "rgba(150,120,245,1)", orbit: 0.3, period: 9, phase: 2.1 },
  { color: "rgba(90,205,190,0.95)", orbit: 0.28, period: 11, phase: 4.2 },
  { color: "rgba(240,140,205,0.9)", orbit: 0.24, period: 13, phase: 1.1 },
];

function Blob({ b, clock, size, still }: { b: (typeof blobs)[number]; clock: SharedValue<number>; size: number; still: boolean }) {
  const r = size * 0.46;
  const c = useDerivedValue(() => {
    const t = still ? b.phase : (clock.value / 1000) * (2 * Math.PI) / b.period + b.phase;
    return vec(size / 2 + Math.cos(t) * b.orbit * size, size / 2 + Math.sin(t * 1.3) * b.orbit * size);
  });
  return <Circle c={c} r={r}><RadialGradient c={c} r={r} colors={[b.color, b.color.replace(/[\d.]+\)$/, "0)")]} /></Circle>;
}

export function HeroOrb({ size = 132 }: { size?: number }) {
  const clock = useClock();
  const still = useReducedMotion();
  const orb = size * 0.64;
  return <View style={[surfaceStyle, { width: size, height: size, borderRadius: size * 0.28, alignItems: "center", justifyContent: "center" }]}>
    <View style={{ width: orb, height: orb, borderRadius: orb / 2, overflow: "hidden", backgroundColor: "#EEF2FC", boxShadow: "0 8px 24px rgba(63,127,224,0.28), inset 0 1px 0 rgba(255,255,255,0.9)" }}>
      <Canvas style={{ width: orb, height: orb }}>
        <Group>{blobs.map((b, i) => <Blob key={i} b={b} clock={clock} size={orb} still={still} />)}</Group>
      </Canvas>
    </View>
  </View>;
}
