import { Canvas, Fill, Shader, Skia } from "@shopify/react-native-skia";
import { useWindowDimensions } from "react-native";
import { useDerivedValue, useReducedMotion, type SharedValue } from "react-native-reanimated";
import { useCalmClock } from "./calm-clock";

/**
 * The voice glow (after Libraries.dev's VoiceBeam, in Sona's halftone): a dithered azure-to-lilac glow rising from the
 * bottom of the screen. Four soft lobes wave along the edge and rise and bloom with `level` (0–1: the patient's voice,
 * or Sona's while she speaks); while the reply is thought through (`think` 0–1) they gather into one beam that sweeps
 * side to side. `on` (0–1) fades it in and out. Dots on a 3 pt grid, ordered (Bayer 8×8) dithering, the orb's colours: lilac at the faint edge, azure in the core.
 * The clock runs only while `active`; at rest it holds its frame (and `on` at 0 draws nothing). Reduce Motion: no
 * waving or sweep, the glow only brightens and dims.
 */
const glow = Skia.RuntimeEffect.Make(`
uniform float2 res;
uniform float t;
uniform float level;
uniform float think;
uniform float on;
uniform float pitch;

float bayer2(float2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(float2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(float2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

float lobes(float x) {
  float h = 0.0;
  for (int i = 0; i < 4; i++) {
    float f = float(i);
    float c = 0.2 + 0.2 * f + 0.05 * sin(t * (0.5 + 0.13 * f) + f * 1.7);
    float w = 0.14 + 0.03 * sin(t * 0.7 + f);
    float a = 0.7 + 0.3 * sin(t * (1.1 + 0.2 * f) + f * 2.3);
    float d = (x - c) / w;
    h += a * exp(-d * d);
  }
  return h * 0.5;
}

half4 main(float2 q) {
  float2 idx = floor(q / pitch);
  float2 cell = (idx + 0.5) * pitch;
  float x = cell.x / res.x;
  float y = (res.y - cell.y) / res.y;
  float b = (x - (0.5 + 0.36 * sin(t * 1.5))) / 0.11;
  float beam = 0.75 * exp(-b * b);
  float h = (mix(lobes(x) * (0.2 + 0.8 * level), beam, think) + 0.05) * on;
  float I = clamp(1.0 - y / max(h, 0.001), 0.0, 1.0);
  I *= I;
  if (I <= bayer8(idx)) { return half4(0.0); }
  half3 deep = half3(0.145, 0.388, 0.922), mid = half3(0.620, 0.520, 0.945), hot = half3(0.780, 0.680, 0.975);
  half3 col = I < 0.5 ? mix(hot, mid, I * 2.0) : mix(mid, deep, I * 2.0 - 1.0);
  float r = length(q - cell);
  float a = (1.0 - smoothstep(pitch * 0.32, pitch * 0.42, r)) * (0.55 + 0.45 * I) * on;
  return half4(col * a, a);
}`)!;

export function VoiceGlow({ level, think, on, active, height = 220 }: { level: SharedValue<number>; think: SharedValue<number>; on: SharedValue<number>; active: boolean; height?: number }) {
  const still = useReducedMotion();
  const { width } = useWindowDimensions();
  const clock = useCalmClock(active && !still);
  const uniforms = useDerivedValue(() => ({ res: [width, height], t: still ? 0 : clock.value / 1000, level: level.value, think: think.value, on: on.value, pitch: 3 }));
  return <Canvas pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height }}>
    <Fill><Shader source={glow} uniforms={uniforms} /></Fill>
  </Canvas>;
}
