import { Blur, Canvas, Circle, Fill, FractalNoise, Group, LinearGradient, Oval, Paint, RadialGradient, Rect, Shader, Skia, useClock, vec } from "@shopify/react-native-skia";
import { useDerivedValue, useReducedMotion, useSharedValue, type SharedValue } from "react-native-reanimated";

/**
 * The Sona orb, a lilac-blue pearl with a sunbeam tide (orb study round 4, "#5 × Dawn, slow"): a matte,
 * top-lit pearl, white on top, lilac with a hint of pink through the middle, settling into periwinkle, with
 * fine grain. A halftone "sunbeam" enters from the top-left, where the light comes from, and the glass
 * gives way to dots under it. It rises from 8 % to 70 % of the sphere on a 16 s tide and holds at its
 * peak; `flood` (0–1) pushes it further while Sona is working or a step changes. `tx`/`ty` (−1…1)
 * tilt the core and the light. Still under Reduce Motion. The same orb is the sign-in hero and the
 * assistant button in the dock. Measurements are the prototype's 148 pt orb, scaled.
 */
// Body blobs (white, lilac, a touch of pink, periwinkle): [colour, width, height, centre x, centre y (fractions), orbit (pt at 148), speed rad/s, phase]
const blobs: [string, number, number, number, number, number, number, number][] = [
  ["#FFFFFF", 120, 90, 0.5, 0.16, 16, 0.35, 0],
  ["#C9B8F8", 96, 88, 0.3, 0.56, 18, -0.28, 1.8],
  ["#F3C9E8", 80, 70, 0.7, 0.48, 16, 0.22, 3.5],
  ["#6F8FEA", 112, 96, 0.55, 0.9, 14, -0.4, 0.5],
];

// The sunbeam: a 3 pt dot grid over the sphere. Dots appear where the diagonal tide line (top-left
// first) has passed, streaked along that line like aurora, sized and coloured by how lit the sphere
// is there (deep blue in shadow, lilac in the highlight).
const sunbeam = Skia.RuntimeEffect.Make(`
uniform float size;
uniform float t;
uniform float ratio;
uniform float2 tilt;
uniform float pitch;

half3 ramp(float h, half3 a, half3 b, half3 c, half3 d, half3 e) {
  float f = clamp(h, 0.0, 0.999) * 4.0;
  if (f < 1.0) { return mix(a, b, f); }
  if (f < 2.0) { return mix(b, c, f - 1.0); }
  if (f < 3.0) { return mix(c, d, f - 2.0); }
  return mix(d, e, f - 3.0);
}

float shade(float2 n) {
  float nz = sqrt(max(0.0, 1.0 - dot(n, n)));
  float lam = max(0.0, (-0.42 - tilt.x * 0.3) * n.x + (-0.55 - tilt.y * 0.3) * n.y + 0.72 * nz);
  float2 c1 = float2(-0.3 + 0.25 * cos(0.35 * t), -0.45 + 0.15 * sin(0.3 * t));
  float2 c2 = float2(0.35 * cos(0.22 * t + 2.0), 0.2 + 0.2 * sin(0.28 * t));
  float cl = exp(-dot(n - c1, n - c1) / 0.12) + 0.7 * exp(-dot(n - c2, n - c2) / 0.2);
  return clamp(0.12 + 0.62 * lam + 0.3 * cl - 0.2 * max(0.0, n.y), 0.0, 1.0);
}

half4 main(float2 q) {
  float half_ = size * 0.5;
  float2 cell = (floor(q / pitch) + 0.5) * pitch;
  float2 n = (cell - half_) / half_;
  float r = length(n);
  if (r > 1.0) { return half4(0.0); }
  float f = (n.x + n.y) / 2.83 + 0.5 + 0.04 * sin(((n.y - n.x) / 2.83) * 9.0 + t * 0.5);
  float k = ratio >= 0.995 ? 1.0 : (ratio - f) / 0.12;
  if (k <= 0.0) { return half4(0.0); }
  float m = min(1.0, k);
  float u = (n.x + 1.0) * 0.5;
  float streak = 0.5 + 0.5 * sin(u * 19.0 + n.y * 7.0 + t * 0.24 + sin(t * 0.3 + u * 3.0));
  float I = pow(m, 1.2) * (m < 1.0 ? 0.3 + 0.7 * streak : 1.0) * min(1.0, (1.0 - r) / 0.08);
  if (I < 0.06) { return half4(0.0); }
  float v = shade(n);
  half3 cool = ramp(v, half3(0.247, 0.416, 0.847), half3(0.435, 0.561, 0.918), half3(0.561, 0.651, 0.961), half3(0.498, 0.765, 0.894), half3(0.624, 0.890, 0.839));
  half3 lit = ramp(v, half3(0.353, 0.490, 0.902), half3(0.561, 0.651, 0.961), half3(0.765, 0.659, 0.949), half3(0.86, 0.72, 0.97), half3(0.96, 0.82, 0.93));
  half3 col = mix(cool, lit, 0.8);
  float rad = ((0.45 + (1.0 - v) * 0.95) * (0.55 + 0.45 * I) + 0.15) * pitch / 3.0;
  float d = length(q - cell);
  float dotShape = 1.0 - smoothstep(rad - 0.25, rad + 0.15, d);
  float a = dotShape * (0.45 + 0.55 * I);
  return half4(col * a, a);
}`)!;

function Blob({ spec, clock, s, k, still, tx, ty }: { spec: (typeof blobs)[number]; clock: SharedValue<number>; s: number; k: number; still: boolean; tx: SharedValue<number>; ty: SharedValue<number> }) {
  const [color, w, h, bx, by, orbit, speed, phase] = spec;
  const at = useDerivedValue(() => {
    const t = still ? 0 : clock.value / 1000;
    const a = t * speed + phase;
    return [
      { translateX: bx * s + Math.cos(a) * orbit * k + tx.value * 18 * k },
      { translateY: by * s + Math.sin(a * 0.9) * orbit * k + ty.value * 18 * k },
    ];
  });
  return <Group transform={at}><Oval x={-w * k / 2} y={-h * k / 2} width={w * k} height={h * k} color={color} /></Group>;
}

// The 16 s tide, 8 % to 70 %: rise over 35 %, hold at the peak for 20 %, recede over 45 %.
function tide(t: number) {
  "worklet";
  const p = (t % 16) / 16;
  const rise = (1 - Math.cos(Math.PI * Math.min(1, p / 0.35))) / 2;
  const fall = (1 - Math.cos(Math.PI * Math.max(0, (p - 0.55) / 0.45))) / 2;
  return 0.08 + 0.62 * (p < 0.35 ? rise : p < 0.55 ? 1 : 1 - fall);
}

/** The orb drawn in a canvas `size + 2 × pad` wide (the pad leaves room for its soft lift). */
export function SonaOrb({ size = 148, flood, tx, ty, lift = true }: { size?: number; flood?: SharedValue<number>; tx?: SharedValue<number>; ty?: SharedValue<number>; lift?: boolean }) {
  const clock = useClock();
  const still = useReducedMotion();
  const zero = useSharedValue(0);
  const fl = flood ?? zero, x = tx ?? zero, y = ty ?? zero;
  const s = size, k = s / 148, pad = orbPad(s), W = s + pad * 2, center = vec(s / 2, s / 2);
  const time = useDerivedValue(() => still ? 0 : clock.value / 1000);
  const ratio = useDerivedValue(() => Math.min(1, Math.max(tide(time.value), fl.value)));
  // Small orbs keep a coarser grid so the dots still read as dots.
  const uniforms = useDerivedValue(() => ({ size: s, t: time.value, ratio: ratio.value, tilt: [x.value, y.value], pitch: Math.max(2.2, 3 * k) }));
  // The glass body fades out under the tide line (same diagonal, flattened), down to a faint 8 %.
  const fade = useDerivedValue(() => {
    const R = ratio.value;
    if (R >= 0.995) return [0, 0.5, 0.99, 1];
    const a = Math.min(0.97, Math.max(0, R - 0.08));
    return [0, a, Math.min(1, Math.max(a + 0.02, R + 0.08)), 1];
  });
  const breathe = useDerivedValue(() => [{ scale: 1 + 0.02 * (1 - Math.cos(time.value * Math.PI / 4)) / 2 }]);
  const tiltCore = useDerivedValue(() => [{ translateX: x.value * 8 * k }, { translateY: y.value * 8 * k }]);
  return <Canvas pointerEvents="none" style={{ width: W, height: W }}>
        <Group transform={[{ translateX: pad }, { translateY: pad }]}>
          <Group origin={center} transform={breathe}>
            {/* Soft lift under the pearl. */}
            {lift && <Circle c={vec(s / 2, s / 2 + 10 * k)} r={s * 0.44} color="rgba(120,100,210,0.34)"><Blur blur={14 * k} /></Circle>}

            <Group clip={Skia.RRectXY(Skia.XYWHRect(0, 0, s, s), s / 2, s / 2)} transform={tiltCore}>
              {/* The glass body, fading out where the sunbeam has passed. */}
              <Group layer>
                <Circle c={center} r={s / 2}><RadialGradient c={vec(s * 0.34, s * 0.26)} r={s * 0.82} colors={["#FFFFFF", "#EEF0FF", "#C3CCF6"]} positions={[0, 0.42, 1]} /></Circle>
                <Group layer={<Paint><Blur blur={18 * k} /></Paint>}>
                  {blobs.map((b, i) => <Blob key={i} spec={b} clock={clock} s={s} k={k} still={still} tx={x} ty={y} />)}
                </Group>
                <Fill blendMode="overlay" opacity={0.14}><FractalNoise freqX={0.9} freqY={0.9} octaves={2} /></Fill>
                {/* Inner shading: darker toward the lower right, away from the light. */}
                <Circle c={center} r={s / 2}><RadialGradient c={vec(s * 0.4, s * 0.36)} r={s * 0.66} colors={["rgba(60,60,160,0)", "rgba(60,60,160,0)", "rgba(60,60,160,0.2)"]} positions={[0, 0.7, 1]} /></Circle>
                {/* dstIn keeps the body only where the gradient is opaque: faint under the sunbeam, full elsewhere. */}
                <Rect x={0} y={0} width={s} height={s} blendMode="dstIn">
                  <LinearGradient start={vec(0, 0)} end={vec(s, s)} positions={fade} colors={["rgba(255,255,255,0.08)", "rgba(255,255,255,0.08)", "white", "white"]} />
                </Rect>
              </Group>
              {/* The sunbeam dots. */}
              <Fill><Shader source={sunbeam} uniforms={uniforms} /></Fill>
            </Group>

            {/* Fixed glass: a soft glare at the top left, a bright rim and a faint blue catch along the bottom. */}
            <Group clip={Skia.RRectXY(Skia.XYWHRect(0, 0, s, s), s / 2, s / 2)} layer={<Paint><Blur blur={6 * k} /></Paint>}>
              <Oval x={s * 0.12} y={s * 0.06} width={s * 0.5} height={s * 0.26} color="rgba(255,255,255,0.72)" />
            </Group>
            <Circle c={center} r={s / 2 - 0.5} style="stroke" strokeWidth={1}>
              <LinearGradient start={vec(0, 0)} end={vec(0, s)} colors={["rgba(255,255,255,0.85)", "rgba(255,255,255,0.5)", "rgba(36,91,204,0.22)"]} />
            </Circle>
          </Group>
        </Group>
  </Canvas>;
}

/** Room around the orb for its lift shadow. */
export const orbPad = (size: number) => size * 0.17;
