import { Canvas, Circle, RadialGradient, Rect, useClock, vec } from "@shopify/react-native-skia";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { useDerivedValue, useReducedMotion, type SharedValue } from "react-native-reanimated";

/**
 * The calm canvas behind every screen (after mymind's Serendipity background and the Lumi care kit):
 * large soft fields of lilac, periwinkle, mint and blush drifting slowly over a pale ground, with a
 * white pool behind the content so text stays crisp. Each field wanders on its own slow orbit
 * (19–31 s), on the UI thread; with Reduce Motion the fields hold still.
 */
type Field = { x: number; y: number; r: number; color: string; dx: number; dy: number; period: number; phase: number };
const fields: Field[] = [
  { x: 0.1, y: 0.08, r: 0.62, color: "rgba(186,176,250,0.95)", dx: 0.12, dy: 0.06, period: 23, phase: 0 }, // lilac, top left
  { x: 0.95, y: 0.3, r: 0.55, color: "rgba(168,194,248,0.85)", dx: 0.1, dy: 0.09, period: 29, phase: 1.7 }, // periwinkle, right
  { x: 0.02, y: 0.66, r: 0.55, color: "rgba(176,232,218,0.8)", dx: 0.09, dy: 0.08, period: 31, phase: 3.1 }, // mint, left
  { x: 0.88, y: 0.98, r: 0.6, color: "rgba(242,200,232,0.7)", dx: 0.1, dy: 0.05, period: 19, phase: 4.4 }, // blush, bottom right
  { x: 0.5, y: 0.5, r: 0.5, color: "rgba(250,251,255,0.9)", dx: 0.05, dy: 0.1, period: 27, phase: 2.3 }, // white pool behind content
];

function Glow({ field: f, clock, width, height, still }: { field: Field; clock: SharedValue<number>; width: number; height: number; still: boolean }) {
  const r = f.r * Math.max(width, height) * 0.62;
  const c = useDerivedValue(() => {
    const t = still ? 0 : (clock.value / 1000) * (2 * Math.PI) / f.period + f.phase;
    return vec((f.x + f.dx * Math.sin(t)) * width, (f.y + f.dy * Math.cos(t * 0.8)) * height);
  });
  return <Circle c={c} r={r}><RadialGradient c={c} r={r} colors={[f.color, "rgba(255,255,255,0)"]} /></Circle>;
}

export function CalmCanvas() {
  const { width, height } = useWindowDimensions();
  const still = useReducedMotion();
  const clock = useClock();
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <Canvas style={StyleSheet.absoluteFill}>
      <Rect x={0} y={0} width={width} height={height} color="#F3F4FA" />
      {fields.map((f, i) => <Glow key={i} field={f} clock={clock} width={width} height={height} still={still} />)}
    </Canvas>
  </View>;
}
