import { Canvas, Fill, ImageShader, Shader, Skia, TileMode, makeImageFromView, type SkImage } from "@shopify/react-native-skia";
import { useEffect, useState, type RefObject } from "react";
import { StyleSheet, useWindowDimensions, type View } from "react-native";
import { Easing, useDerivedValue, useSharedValue, withRepeat, withSpring, withTiming } from "react-native-reanimated";

/**
 * Liquid glass that swells out of the mic while it is held (after Monogram's
 * hold-to-talk): a dome widens into a meniscus that refracts the content beneath it,
 * with a travelling specular rim, faint dispersion and frost deepening towards the dock.
 */
const effect = Skia.RuntimeEffect.Make(`
uniform shader soft;
uniform shader heavy;
uniform float2 size;
uniform float level;   // rise, 0 = resting in the mic, 1 = listening, >1 floods
uniform float spread;  // 0 = narrow dome over the mic, 1 = full-width meniscus
uniform float time;
uniform float pulse;   // 0..1 breathing

float surface(float nx) {
  float sigma = mix(0.09, 0.95, spread);
  float x = nx - 0.5;
  float dome = exp(-(x * x) / (2.0 * sigma * sigma));
  float rise = size.y * 0.56 * level * (1.0 + 0.012 * pulse);
  float ripple = (2.4 * sin(nx * 5.1 + time * 1.05) + 1.6 * sin(nx * 9.7 - time * 1.63)) * min(level, 1.0) * (0.6 + 0.4 * pulse);
  return size.y + 40.0 - rise * dome + ripple;
}

half4 main(float2 p) {
  float nx = p.x / size.x;
  float edge = surface(nx);
  float d = p.y - edge;

  // Soft contact shadow on the sharp content just above the glass.
  if (d < 0.0) {
    float shade = exp(-pow((d + 3.0) / 12.0, 2.0)) * 0.07 * min(level, 1.0);
    return half4(0.0, 0.0, 0.0, shade);
  }

  // Refraction is strongest where the glass is thickest to the eye: just under its edge.
  float slope = (surface(nx + 0.004) - surface(nx - 0.004)) / (0.008 * size.x);
  float2 normal = normalize(float2(slope, -1.0));
  float bend = exp(-pow(d / 58.0, 2.0)) * 30.0 + 6.0;
  float2 q = p - normal * bend;

  float depth = clamp(d / (size.y * 0.4), 0.0, 1.0);
  float disperse = bend * 0.06;
  half4 base = mix(soft.eval(q), heavy.eval(q), depth);
  half r = mix(soft.eval(q + normal * disperse), heavy.eval(q + normal * disperse), depth).r;
  half b = mix(soft.eval(q - normal * disperse), heavy.eval(q - normal * disperse), depth).b;
  half3 c = half3(r, base.g, b);

  // Frosted body: lifted and lightly tinted near the surface, cooler with depth.
  c = mix(c, half3(1.0), 0.16 * (1.0 - depth));
  c = mix(c, half3(0.9, 0.918, 0.95), 0.12 + 0.3 * depth);

  // Specular rim with a slow travelling glint, and a soft inner glow beneath it.
  float glint = 0.55 + 0.45 * sin(nx * 3.4 - time * 0.7);
  c += half3(exp(-pow(d / 2.6, 2.0)) * 0.55 * glint);
  c += half3(exp(-pow((d - 10.0) / 16.0, 2.0)) * 0.08);

  float alpha = smoothstep(0.0, 3.5, d);
  return half4(c * alpha, alpha);
}`)!;

function blurred(image: SkImage, width: number, height: number, radius: number) {
  const surface = Skia.Surface.MakeOffscreen(width, height) ?? Skia.Surface.Make(width, height);
  if (!surface) return null;
  const paint = Skia.Paint();
  paint.setImageFilter(Skia.ImageFilter.MakeBlur(radius, radius, TileMode.Clamp, null));
  surface.getCanvas().drawImageRect(image, Skia.XYWHRect(0, 0, image.width(), image.height()), Skia.XYWHRect(0, 0, width, height), paint);
  surface.flush();
  return surface.makeImageSnapshot().makeNonTextureImage();
}

export type VeilState = "idle" | "listening" | "flood";

export function LiquidVeil({ backdrop, state, reducedMotion, onUnavailable }: { backdrop: RefObject<View | null>; state: VeilState; reducedMotion: boolean; onUnavailable: () => void }) {
  const { width, height } = useWindowDimensions();
  const [layers, setLayers] = useState<{ soft: SkImage; heavy: SkImage } | null>(null);
  const level = useSharedValue(0), spread = useSharedValue(0), time = useSharedValue(0), pulse = useSharedValue(0);

  // Capture once per hold. The veil shows a frozen frame, so nothing re-renders underneath it.
  useEffect(() => {
    if (state !== "listening") return;
    let live = true;
    const view = backdrop.current;
    if (!view) { onUnavailable(); return; }
    makeImageFromView(backdrop as RefObject<View>).then(image => {
      if (!live) return;
      const soft = image && blurred(image, width, height, 7), heavy = image && blurred(image, width, height, 24);
      if (soft && heavy) setLayers({ soft, heavy }); else onUnavailable();
    }).catch(() => live && onUnavailable());
    return () => { live = false; };
  }, [state]);

  useEffect(() => {
    const settle = Easing.bezier(0.22, 1, 0.36, 1), glide = Easing.bezier(0.65, 0, 0.35, 1);
    if (state === "listening" && layers) {
      // Swells out of the mic as a dome, then widens into a meniscus and settles.
      level.set(reducedMotion ? withTiming(1, { duration: 220 }) : withSpring(1, { duration: 950, dampingRatio: 0.86 }));
      spread.set(reducedMotion ? 1 : withTiming(1, { duration: 1150, easing: settle }));
      if (!reducedMotion) {
        time.set(0); time.set(withRepeat(withTiming(90, { duration: 90000, easing: Easing.linear }), -1));
        pulse.set(withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin) }), -1, true));
      }
    } else if (state === "flood") {
      level.set(withTiming(1.95, { duration: 560, easing: glide }));
      spread.set(withTiming(1, { duration: 300 }));
      pulse.set(withTiming(0, { duration: 300 }));
    } else {
      // Gathers back into the mic.
      level.set(withTiming(0, { duration: 420, easing: glide }));
      spread.set(withTiming(0, { duration: 420, easing: glide }));
      pulse.set(withTiming(0, { duration: 300 }));
    }
  }, [state, layers, reducedMotion]);
  useEffect(() => { if (state === "idle") { const t = setTimeout(() => setLayers(null), 520); return () => clearTimeout(t); } }, [state]);

  const uniforms = useDerivedValue(() => ({ size: [width, height], level: level.value, spread: spread.value, time: time.value, pulse: pulse.value }));
  if (!layers) return null;
  return <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
    <Fill>
      <Shader source={effect} uniforms={uniforms}>
        <ImageShader image={layers.soft} fit="fill" tx="clamp" ty="clamp" rect={{ x: 0, y: 0, width, height }} />
        <ImageShader image={layers.heavy} fit="fill" tx="clamp" ty="clamp" rect={{ x: 0, y: 0, width, height }} />
      </Shader>
    </Fill>
  </Canvas>;
}
