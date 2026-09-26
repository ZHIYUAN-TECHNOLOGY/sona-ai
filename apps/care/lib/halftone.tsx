import { Canvas, Fill, Shader, Skia } from "@shopify/react-native-skia";

/**
 * The brand's dithering, kept to an accent: a still patch of halftone dots, densest at `origin` and
 * thinning out over `reach`, like light catching the edge of glass. Drawn once; nothing animates.
 * ponytail: mirrors apps/native/components/sona/halftone-shimmer.tsx; move both to a shared UI package.
 */
const glint = Skia.RuntimeEffect.Make(`
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

export function HalftoneGlint({ width, height, origin, reach, pitch = 4, strength = 1, tint = [0.3, 0.62, 0.86], hueShift = 1, style }: { width: number; height: number; origin: [number, number]; reach: [number, number]; pitch?: number; strength?: number; tint?: [number, number, number]; hueShift?: number; style?: object }) {
  return <Canvas pointerEvents="none" style={[{ position: "absolute", width, height }, style]}>
    <Fill><Shader source={glint} uniforms={{ origin, reach, pitch, strength, tint, hueShift, res: [width, height] }} /></Fill>
  </Canvas>;
}
