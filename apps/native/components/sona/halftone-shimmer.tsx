import { Canvas, Fill, Shader, Skia } from "@shopify/react-native-skia";
import { type SharedValue, useDerivedValue } from "react-native-reanimated";

/**
 * A band of aurora halftone dots that sweeps across a surface while it morphs; strongest
 * mid-morph (sin π·p) and gone at either end. Fixed canvas size, clipped by its parent.
 */
const effect = Skia.RuntimeEffect.Make(`
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
    <Fill><Shader source={effect} uniforms={uniforms} /></Fill>
  </Canvas>;
}
