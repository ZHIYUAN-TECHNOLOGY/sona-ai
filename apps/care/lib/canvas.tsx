import { Blur, Canvas, Circle, Group, Paint, Path, RadialGradient, Rect, Skia, useClock, vec } from "@shopify/react-native-skia";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { useDerivedValue, useReducedMotion, type SharedValue } from "react-native-reanimated";

/**
 * The canvas behind every screen (after the Life OS dashboard's hero): a cool near-white ground with a
 * blue liquid hero across the top: soft blue pools under glossy white and blue ribbons that drift
 * slowly (each on its own 19–31 s cycle, on the UI thread), fading into white before the content.
 * A faint blue pool sits at the bottom behind the dock. With Reduce Motion everything holds still.
 */
type Pool = { x: number; y: number; r: number; color: string };
const pools: Pool[] = [
  { x: 0.15, y: 0.02, r: 0.55, color: "rgba(186,205,245,0.95)" }, // deep blue, top left
  { x: 0.85, y: 0.06, r: 0.5, color: "rgba(206,221,250,0.95)" }, // sky, top right
  { x: 0.5, y: 0.2, r: 0.42, color: "rgba(226,234,252,0.9)" }, // pale blue, under the ribbons
  { x: 0.5, y: 1.05, r: 0.5, color: "rgba(214,224,250,0.7)" }, // blue behind the dock
];
// Ribbons: [centre y (fraction), amplitude (fraction of height), wavelength (fraction of width), stroke width, colour, period s, phase]
const ribbons: [number, number, number, number, string, number, number][] = [
  [0.1, 0.05, 1.3, 90, "rgba(255,255,255,0.75)", 23, 0],
  [0.19, 0.045, 1.1, 60, "rgba(160,186,244,0.55)", 29, 1.7],
  [0.26, 0.035, 1.5, 110, "rgba(255,255,255,0.85)", 31, 3.1],
  [0.05, 0.03, 0.9, 40, "rgba(125,160,240,0.45)", 19, 4.4],
];

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

export function CalmCanvas() {
  const { width, height } = useWindowDimensions();
  const still = useReducedMotion();
  const clock = useClock();
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <Canvas style={StyleSheet.absoluteFill}>
      <Rect x={0} y={0} width={width} height={height} color="#F5F7FB" />
      {pools.map((p, i) => {
        const r = p.r * Math.max(width, height) * 0.62, c = vec(p.x * width, p.y * height);
        return <Circle key={i} c={c} r={r}><RadialGradient c={c} r={r} colors={[p.color, "rgba(245,247,251,0)"]} /></Circle>;
      })}
      <Group layer={<Paint><Blur blur={22} /></Paint>}>
        {ribbons.map((r, i) => <Ribbon key={i} spec={r} clock={clock} width={width} height={height} still={still} />)}
      </Group>
      {/* The hero fades into the white body of the page before the content cards. */}
      <Rect x={0} y={height * 0.3} width={width} height={height * 0.7}>
        <RadialGradient c={vec(width / 2, height * 0.62)} r={height * 0.55} colors={["rgba(250,251,254,0.96)", "rgba(250,251,254,0.9)", "rgba(250,251,254,0)"]} positions={[0, 0.55, 1]} />
      </Rect>
    </Canvas>
  </View>;
}
