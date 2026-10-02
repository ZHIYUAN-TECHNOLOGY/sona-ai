import { Blur, Canvas, Circle, Group, LinearGradient, Paint, Path, RadialGradient, Rect, Skia, useClock, vec } from "@shopify/react-native-skia";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { useState } from "react";
import { useDerivedValue, useReducedMotion, type SharedValue } from "react-native-reanimated";

/**
 * The canvas behind every screen (the kit's aurora in Sona Care's azure and violet): a #FAFAFA ground with
 * azure pools and soft azure, violet and white ribbons across the top, a white body behind the content,
 * and a violet-azure glow at the bottom behind the dock. Pools and ribbons drift on their own 19–31 s cycles on
 * the UI thread; with Reduce Motion everything holds still.
 */
type Pool = { x: number; y: number; r: number; color: string; dx: number; period: number; phase: number };
const pools: Pool[] = [
  { x: 0.2, y: 0.0, r: 0.5, color: "rgba(211,224,251,0.95)", dx: 0.1, period: 23, phase: 0 }, // azure, top left
  { x: 0.85, y: 0.04, r: 0.46, color: "rgba(220,230,252,0.9)", dx: 0.08, period: 29, phase: 1.7 }, // pale azure, top right
  { x: 0.3, y: 1.02, r: 0.48, color: "rgba(238,222,252,0.85)", dx: 0.1, period: 26, phase: 5.2 }, // violet glow, bottom left
  { x: 0.78, y: 1.04, r: 0.5, color: "rgba(211,224,251,0.85)", dx: 0.08, period: 19, phase: 4.4 }, // azure glow, bottom right
];
// Ribbons: [centre y (fraction), amplitude (fraction of height), wavelength (fraction of width), stroke width, colour, period s, phase]
const ribbons: [number, number, number, number, string, number, number][] = [
  [0.1, 0.035, 1.3, 70, "rgba(255,255,255,0.8)", 23, 0],
  [0.15, 0.03, 1.1, 46, "rgba(194,211,249,0.8)", 29, 1.7], // the azure band
  [0.2, 0.03, 1.5, 90, "rgba(255,255,255,0.9)", 31, 3.1],
  [0.05, 0.025, 0.9, 44, "rgba(233,214,251,0.7)", 19, 4.4],
];

function Glow({ pool: p, clock, width, height, still }: { pool: Pool; clock: SharedValue<number>; width: number; height: number; still: boolean }) {
  const r = p.r * Math.max(width, height) * 0.62;
  const c = useDerivedValue(() => {
    const t = still ? p.phase : (clock.value / 1000) * (2 * Math.PI) / p.period + p.phase;
    return vec((p.x + p.dx * Math.sin(t)) * width, p.y * height + Math.cos(t * 0.8) * 0.02 * height);
  });
  return <Circle c={c} r={r}><RadialGradient c={c} r={r} colors={[p.color, "rgba(250,250,250,0)"]} /></Circle>;
}

function Ribbon({ spec, clock, width, height, still }: { spec: (typeof ribbons)[number]; clock: SharedValue<number>; width: number; height: number; still: boolean }) {
  const [cy, amp, wave, stroke, color, period, phase] = spec;
  const path = useDerivedValue(() => {
    const t = still ? phase : (clock.value / 1000) * (2 * Math.PI) / period + phase;
    const p = Skia.Path.Make();
    const steps = 24, k = (2 * Math.PI) / (wave * width);
    for (let i = 0; i <= steps; i++) {
      const x = -width * 0.2 + (width * 1.4 * i) / steps;
      const y = cy * height + Math.sin(x * k + t) * amp * height + Math.sin(x * k * 0.5 - t * 0.6) * amp * 0.4 * height;
      if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
    }
    return p;
  });
  return <Path path={path} style="stroke" strokeWidth={stroke} strokeCap="round" color={color} />;
}

// Every screen draws its own canvas, so all of them read one app-wide clock: two pages crossfading show the same sky.
const EPOCH = Date.now();
export function CalmCanvas() {
  const { width, height } = useWindowDimensions();
  const still = useReducedMotion();
  const local = useClock();
  const [since] = useState(() => Date.now() - EPOCH);
  const clock = useDerivedValue(() => local.value + since);
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <Canvas style={StyleSheet.absoluteFill}>
      <Rect x={0} y={0} width={width} height={height} color="#FAFAFA" />
      {pools.map((p, i) => <Glow key={i} pool={p} clock={clock} width={width} height={height} still={still} />)}
      <Group layer={<Paint><Blur blur={24} /></Paint>}>
        {ribbons.map((r, i) => <Ribbon key={i} spec={r} clock={clock} width={width} height={height} still={still} />)}
      </Group>
      {/* The aurora fades into a faintly tinted body (never pure white, so glass cards keep an edge), and back out at the bottom glow. */}
      <Rect x={0} y={0} width={width} height={height}>
        <LinearGradient start={vec(0, 0)} end={vec(0, height)} colors={["rgba(250,251,255,0)", "rgba(250,251,255,0.8)", "rgba(248,249,255,0.7)", "rgba(250,251,255,0)"]} positions={[0.12, 0.34, 0.78, 0.96]} />
      </Rect>
    </Canvas>
  </View>;
}
