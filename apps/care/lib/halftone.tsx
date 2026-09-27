import { Canvas, Fill, Shader, Skia } from "@shopify/react-native-skia";
import { useEffect, useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import { Easing, useDerivedValue, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { glint as tones } from "./theme";

/**
 * The brand's dithering, kept to an accent: a still patch of halftone dots, densest at `origin` and
 * thinning out over `reach`, like light catching the edge of glass. Drawn once; nothing animates.
 * Blue at the origin side, lilac across, by default.
 * ponytail: mirrors apps/native/components/sona/halftone-shimmer.tsx; move both to a shared UI package.
 */
const glint = Skia.RuntimeEffect.Make(`
uniform float2 origin;
uniform float2 reach;
uniform float pitch;
uniform float strength;
uniform half3 tint;
uniform half3 tintTo;
uniform float hueShift;
uniform float2 res;
half4 main(float2 q) {
  float a = strength * (1.0 - clamp(length((q - origin) / reach), 0.0, 1.0));
  float r = 0.46 * sqrt(a);
  if (r < 0.06) { return half4(0.0); }
  float dotShape = 1.0 - smoothstep(r - 0.08, r + 0.04, length(fract(q / pitch) - 0.5));
  half3 hue = mix(tint, tintTo, hueShift * q.x / res.x);
  float alpha = dotShape * 0.4;
  return half4(hue * alpha, alpha);
}`)!;

type RGB = readonly [number, number, number];

export function HalftoneGlint({ width, height, origin, reach, pitch = 4, strength = 1, tint = tones.from, tintTo = tones.to, hueShift = 1, style }: { width: number; height: number; origin: [number, number]; reach: [number, number]; pitch?: number; strength?: number; tint?: RGB; tintTo?: RGB; hueShift?: number; style?: object }) {
  return <Canvas pointerEvents="none" style={[{ position: "absolute", width, height }, style]}>
    <Fill><Shader source={glint} uniforms={{ origin, reach, pitch, strength, tint: [...tint], tintTo: [...tintTo], hueShift, res: [width, height] }} /></Fill>
  </Canvas>;
}

/**
 * The sunbeam: a band of halftone dots (blue to lilac) that sweeps once across a card from the
 * top-left, the only dithering that moves, kept for a finished task (a dose taken, a check-in sent).
 * Plays each time `play` changes to a new truthy value; nothing under Reduce Motion.
 */
const beam = Skia.RuntimeEffect.Make(`
uniform float2 res;
uniform float p;
uniform float pitch;
half4 main(float2 q) {
  float2 n = q / res;
  float d = (n.x + n.y) * 0.5;
  float c = mix(-0.3, 1.3, p);
  float band = 1.0 - smoothstep(0.0, 0.16, abs(d - c));
  if (band < 0.02) { return half4(0.0); }
  float r = 0.42 * sqrt(band);
  float dotShape = 1.0 - smoothstep(r - 0.08, r + 0.04, length(fract(q / pitch) - 0.5));
  half3 hue = mix(half3(0.3, 0.42, 0.95), half3(0.72, 0.64, 0.98), clamp(d, 0.0, 1.0));
  float alpha = dotShape * 0.55 * sin(3.14159 * p);
  return half4(hue * alpha, alpha);
}`)!;

export function Sunbeam({ play, radius = 24 }: { play: unknown; radius?: number }) {
  const still = useReducedMotion();
  const p = useSharedValue(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!play || still) return;
    p.set(0);
    p.set(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.cubic) }));
  }, [play, still, p]);
  const uniforms = useDerivedValue(() => ({ res: [Math.max(1, size.width), Math.max(1, size.height)], p: p.value, pitch: 4 }));
  const onLayout = (e: LayoutChangeEvent) => setSize(e.nativeEvent.layout);
  if (!play || still) return null;
  return <View pointerEvents="none" onLayout={onLayout} style={{ position: "absolute", inset: 0, borderRadius: radius, overflow: "hidden" }}>
    {size.width > 0 && <Canvas style={{ width: size.width, height: size.height }}><Fill><Shader source={beam} uniforms={uniforms} /></Fill></Canvas>}
  </View>;
}
