import { Canvas, Fill, ImageShader, Shader, Skia, TileMode, makeImageFromView, type SkImage } from "@shopify/react-native-skia";
import { useEffect, useState, type RefObject } from "react";
import { StyleSheet, useWindowDimensions, type View } from "react-native";
import { Easing, useDerivedValue, useSharedValue, withRepeat, withSpring, withTiming } from "react-native-reanimated";

/**
 * Liquid glass that swells out of the mic while it is held (after Monogram's
 * hold-to-talk): a dome widens into a meniscus that refracts the content beneath it,
 * with a travelling specular rim, faint dispersion, frost deepening towards the dock
 * and slow ambient light rendered as ordered-dither dots.
 */
const effect = Skia.RuntimeEffect.Make(`
uniform shader soft;
uniform shader heavy;
uniform float2 size;
uniform float level;   // rise, 0 = resting in the mic, 1 = listening, >1 floods
uniform float spread;  // 0 = narrow dome over the mic, 1 = full-width meniscus
uniform float time;
uniform float pulse;   // 0..1 breathing

// Ordered (Bayer) thresholds without integer ops.
float bayer2(float2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(float2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(float2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

// Slow ambient light drifting inside the glass, 0..1.
float glow(float2 p) {
  float2 uv = p / size;
  float2 asp = float2(size.x / size.y, 1.0);
  float t = time * 0.11;
  float2 a = (uv - float2(0.28 + 0.12 * sin(t * 1.3), 0.8 + 0.05 * cos(t))) * asp;
  float2 b = (uv - float2(0.74 + 0.1 * cos(t * 0.9 + 1.7), 0.68 + 0.06 * sin(t * 1.1))) * asp;
  float2 c = (uv - float2(0.5 + 0.2 * sin(t * 0.7 + 3.0), 0.95)) * asp;
  float g = 0.85 * exp(-dot(a, a) * 16.0) + 0.7 * exp(-dot(b, b) * 20.0) + 0.75 * exp(-dot(c, c) * 12.0);
  g += 0.06 * sin(uv.x * 8.0 + t * 2.0) * sin(uv.y * 6.0 - t * 1.5);
  return smoothstep(0.08, 0.95, clamp(g, 0.0, 1.0));
}

// Round dots on a 4pt grid; the Bayer threshold decides which cells light up.
float dither(float2 p, float amount) {
  float2 cell = p / 4.0;
  if (amount <= bayer8(floor(cell))) { return 0.0; }
  float r = 0.16 + 0.16 * amount;
  return 1.0 - smoothstep(r - 0.1, r + 0.04, length(fract(cell) - 0.5));
}

float surface(float nx) {
  float sigma = mix(0.09, 0.95, spread);
  float x = nx - 0.5;
  float dome = exp(-(x * x) / (2.0 * sigma * sigma));
  float rise = size.y * 0.56 * level * (1.0 + 0.01 * pulse);
  float ripple = (2.0 * sin(nx * 4.6 + time * 0.62) + 1.2 * sin(nx * 8.9 - time * 0.95)) * min(level, 1.0) * (0.6 + 0.4 * pulse);
  return size.y + 40.0 - rise * dome + ripple;
}

half4 main(float2 p) {
  float nx = p.x / size.x;
  float edge = surface(nx);
  float d = p.y - edge;
  float lit = min(level, 1.0);
  half3 ink = half3(0.34, 0.5, 0.86);

  // Above the glass: a faint dotted aura and a soft contact shadow.
  if (d < 0.0) {
    float aura = dither(p, glow(p) * exp(d / 22.0) * 0.5 * lit) * 0.22;
    float shade = exp(-pow((d + 3.0) / 12.0, 2.0)) * 0.05 * lit;
    return half4(ink * aura, aura + shade);
  }

  // Refraction is strongest where the glass is thickest to the eye: just under its edge.
  float slope = (surface(nx + 0.004) - surface(nx - 0.004)) / (0.008 * size.x);
  float2 normal = normalize(float2(slope, -1.0));
  float bend = exp(-pow(d / 60.0, 2.0)) * 22.0 + 5.0;
  float2 q = p - normal * bend;

  float depth = clamp(d / (size.y * 0.4), 0.0, 1.0);
  float disperse = bend * 0.05;
  half4 base = mix(soft.eval(q), heavy.eval(q), depth);
  half r = mix(soft.eval(q + normal * disperse), heavy.eval(q + normal * disperse), depth).r;
  half b = mix(soft.eval(q - normal * disperse), heavy.eval(q - normal * disperse), depth).b;
  half3 c = half3(r, base.g, b);

  // Frosted body: lifted near the surface, cooler with depth.
  c = mix(c, half3(1.0), 0.16 * (1.0 - depth));
  c = mix(c, half3(0.9, 0.918, 0.95), 0.12 + 0.3 * depth);

  // Ambient dithered light breathing inside the glass.
  float light = glow(p);
  half3 hue = mix(half3(0.36, 0.62, 0.86), half3(0.42, 0.46, 0.9), nx);
  c = mix(c, hue, light * 0.1 * lit);
  float amount = pow(light, 1.5) * (0.78 + 0.18 * pulse) * lit;
  c = mix(c, hue * 0.9, dither(p, amount) * 0.3);

  // Soft specular rim with a slow glint, and an inner glow beneath it.
  float glint = 0.6 + 0.4 * sin(nx * 3.0 - time * 0.38);
  c += half3(exp(-pow(d / 2.6, 2.0)) * 0.42 * glint);
  c += half3(exp(-pow((d - 10.0) / 18.0, 2.0)) * 0.07);

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
        pulse.set(withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }), -1, true));
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
