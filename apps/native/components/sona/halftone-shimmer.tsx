import { Canvas, Fill, processUniforms, Shader, Skia, type SkRuntimeEffect } from "@shopify/react-native-skia";
import { Image } from "expo-image";
import { PixelRatio } from "react-native";
import { type SharedValue, useDerivedValue } from "react-native-reanimated";

/**
 * A band of aurora halftone dots that sweeps across a surface while it morphs; strongest
 * mid-morph (sin π·p) and gone at either end. Fixed canvas size, clipped by its parent.
 */
// Both shaders here compile when first drawn, not at app start.
let compiledBand: SkRuntimeEffect | undefined;
const effect = () => compiledBand ??= Skia.RuntimeEffect.Make(`
uniform float2 res;
uniform float p;
half4 main(float2 q) {
  float amt = sin(3.14159 * clamp(p, 0.0, 1.0));
  if (amt < 0.02) { return half4(0.0); }
  float x = q.x / res.x;
  float band = exp(-pow((x - mix(-0.25, 1.25, p)) / 0.2, 2.0));
  float a = band * amt;
  float r = 0.46 * sqrt(a);
  if (r < 0.06) { return half4(0.0); }
  float dotShape = 1.0 - smoothstep(r - 0.08, r + 0.04, length(fract(q / 4.0) - 0.5));
  half3 hue = mix(half3(0.3, 0.62, 0.86), half3(0.42, 0.46, 0.92), x);
  float alpha = dotShape * 0.34;
  return half4(hue * alpha, alpha);
}`)!;

export function HalftoneShimmer({ width, height, progress }: { width: number; height: number; progress: SharedValue<number> }) {
  const uniforms = useDerivedValue(() => ({ res: [width, height], p: progress.value }));
  return <Canvas pointerEvents="none" style={{ position: "absolute", left: 0, bottom: 0, width, height }}>
    <Fill><Shader source={effect()} uniforms={uniforms} /></Fill>
  </Canvas>;
}

/**
 * A still patch of halftone dots, densest at `origin` and thinning out over `reach` (x, y):
 * light catching the edge of glass. Drawn once; nothing animates.
 *
 * Shown as an image, not a canvas: each canvas is its own Metal surface, redrawn on the main thread whenever its parent
 * re-renders (31-42 glint redraws while a visit slid in, on screens of 10+ tiles and buttons). The same shader draws each
 * look once, offscreen at the screen's density, so the dots are the same pixels; every later glint with that look reuses it.
 */
let compiledGlint: SkRuntimeEffect | undefined;
const glint = () => compiledGlint ??= Skia.RuntimeEffect.Make(`
uniform float2 origin;
uniform float2 reach;
uniform float pitch;
uniform float strength;
uniform half3 tint;
uniform float hueShift;
uniform float2 res;
half4 main(float2 q) {
  float a = strength * (1.0 - clamp(length((q - origin) / reach), 0.0, 1.0));
  float r = 0.46 * sqrt(a);
  if (r < 0.06) { return half4(0.0); }
  float dotShape = 1.0 - smoothstep(r - 0.08, r + 0.04, length(fract(q / pitch) - 0.5));
  half3 hue = mix(tint, half3(0.42, 0.46, 0.92), hueShift * q.x / res.x);
  float alpha = dotShape * 0.34;
  return half4(hue * alpha, alpha);
}`)!;

// ponytail: kept for the session, never evicted; the looks are a handful (fixed sizes, some per screen width).
const drawn = new Map<string, string>();
function glintImage(width: number, height: number, uniforms: Record<string, number | number[]>) {
  const key = JSON.stringify([width, height, uniforms]);
  const seen = drawn.get(key);
  if (seen) return seen;
  const scale = PixelRatio.get();
  const surface = Skia.Surface.MakeOffscreen(Math.ceil(width * scale), Math.ceil(height * scale));
  if (!surface) return undefined;
  const paint = Skia.Paint();
  paint.setShader(glint().makeShader(processUniforms(glint(), uniforms)));
  const canvas = surface.getCanvas();
  canvas.scale(scale, scale);
  canvas.drawPaint(paint);
  surface.flush();
  const uri = `data:image/png;base64,${surface.makeImageSnapshot().encodeToBase64()}`;
  drawn.set(key, uri);
  return uri;
}

export function HalftoneGlint({ width, height, origin, reach, pitch = 4, strength = 1, tint = [0.3, 0.62, 0.86], hueShift = 1, style }: { width: number; height: number; origin: [number, number]; reach: [number, number]; pitch?: number; strength?: number; tint?: [number, number, number]; hueShift?: number; style?: object }) {
  const uniforms = { origin, reach, pitch, strength, tint, hueShift, res: [width, height] };
  const uri = glintImage(width, height, uniforms);
  // No offscreen surface to draw into: the canvas, as before.
  if (!uri) return <Canvas pointerEvents="none" style={[{ position: "absolute", width, height }, style]}>
    <Fill><Shader source={glint()} uniforms={uniforms} /></Fill>
  </Canvas>;
  return <Image pointerEvents="none" source={uri} cachePolicy="memory" contentFit="fill" style={[{ position: "absolute", width, height }, style]} />;
}
