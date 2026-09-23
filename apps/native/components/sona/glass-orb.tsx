import { Canvas, Fill, Shader, Skia } from "@shopify/react-native-skia";
import { useEffect } from "react";
import { useDerivedValue, useFrameCallback, useSharedValue, withTiming } from "react-native-reanimated";

/**
 * Aurora core orb: a clear glass sphere holding a halftone aurora that curls around its
 * inside, matching the hold-to-talk aurora glass. The aurora drifts slowly at rest, rises and
 * brightens while listening (`energy` 1) and circles gently while thinking.
 */
const effect = Skia.RuntimeEffect.Make(`
uniform float2 res;
uniform float t;
uniform float energy;

float halftone(float2 p, float amount) {
  float r = 0.46 * sqrt(clamp(amount, 0.0, 1.0));
  if (r < 0.07) { return 0.0; }
  return 1.0 - smoothstep(r - 0.1, r + 0.05, length(fract(p / 2.8) - 0.5));
}

half4 main(float2 p) {
  float2 uv = (p - res * 0.5) / (res.x * 0.5);
  float r = length(uv);
  float alpha = smoothstep(1.0, 0.975, r);
  if (alpha <= 0.0) { return half4(0.0); }

  // Aurora in a slowly turning frame, so it curls around the inside of the glass.
  float ang = t * 0.12;
  float2 v = float2(cos(ang) * uv.x - sin(ang) * uv.y, sin(ang) * uv.x + cos(ang) * uv.y);
  float crest = 0.3 - 0.32 * energy + 0.13 * sin(v.x * 3.0 + t * 0.8);
  float dd = v.y - crest;
  float folds = pow(0.5 + 0.5 * sin(v.x * 9.0 + sin(v.x * 3.0 + t * 0.5) * 1.5 + t * 0.4), 1.4);
  float curtain = dd < 0.0 ? exp(dd / (0.34 + 0.2 * energy)) * folds : exp(-pow(dd / 0.09, 2.0));
  float light = curtain * smoothstep(0.95, 0.72, r) * (0.85 + 0.3 * energy);

  float3 hue = mix(mix(float3(0.26, 0.74, 0.8), float3(0.4, 0.48, 0.95), clamp(v.x * 0.5 + 0.5, 0.0, 1.0)), float3(0.6, 0.46, 0.92), clamp(-dd * 1.4, 0.0, 1.0));
  float3 col = float3(0.955, 0.965, 0.995);
  col = mix(col, hue, light * 0.3);
  col = mix(col, hue * 0.92, halftone(p, light) * 0.8);

  // Glass: brighter towards the rim, a faint cool fringe, thin bright edge.
  col = mix(col, float3(1.0), pow(r, 3.0) * 0.3);
  float a = atan(uv.y, uv.x);
  float3 irid = 0.6 + 0.4 * cos(a + t * 0.15 + float3(0.0, 2.1, 4.2));
  col = mix(col, irid * float3(0.72, 0.82, 1.0), smoothstep(0.86, 0.97, r) * (0.5 + 0.5 * sin(a * 2.0 + t * 0.3)) * 0.3);
  col += exp(-pow((r - 0.972) / 0.022, 2.0)) * 0.3;

  // Fixed reflections: window highlight top-left, crescent bottom-right, soft base shade.
  float2 h = (uv - float2(-0.34, -0.5)) * float2(1.0, 1.9);
  col += exp(-dot(h, h) * 9.0) * 0.55;
  float2 n = r > 0.001 ? uv / r : float2(0.0);
  col += exp(-pow((r - 0.88) / 0.06, 2.0)) * smoothstep(0.3, 0.9, dot(n, normalize(float2(0.6, 0.8)))) * 0.25;
  col *= 1.0 - 0.06 * smoothstep(0.1, 1.0, uv.y) * r;

  return half4(half3(col) * alpha, alpha);
}`)!;

export function GlassOrb({ size, energy, still = false }: { size: number; energy: number; still?: boolean }) {
  const t = useSharedValue(Math.random() * 40), level = useSharedValue(energy);
  useEffect(() => { level.set(withTiming(energy, { duration: 600 })); }, [energy, level]);
  // Integrate time on the UI thread so the swirl speeds up smoothly instead of jumping.
  useFrameCallback(frame => {
    const dt = Math.min(frame.timeSincePreviousFrame ?? 16, 64) / 1000;
    t.set(t.value + dt * (0.5 + 1.2 * level.value));
  }, !still);
  const uniforms = useDerivedValue(() => ({ res: [size, size], t: t.value, energy: level.value }));
  return <Canvas pointerEvents="none" style={{ width: size, height: size }}>
    <Fill><Shader source={effect} uniforms={uniforms} /></Fill>
  </Canvas>;
}
