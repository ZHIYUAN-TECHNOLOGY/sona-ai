import { Canvas, Fill, ImageShader, Shader, Skia, TileMode, makeImageFromView, type SkImage } from "@shopify/react-native-skia";
import { useEffect, useState, type RefObject } from "react";
import { StyleSheet, useWindowDimensions, type View } from "react-native";
import { Easing, useDerivedValue, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Aurora glass — Sona's listening surface.
 * Frosted liquid glass widens out of the mic and lifts; its top is a slow aurora wave drawn
 * only by refraction and sheen, with dithered aurora curtains rising from it. It breathes on
 * a 4 s in / 6 s out cycle, and every heard word sends a double swell ("lub-dub") through the
 * glass while the curtains brighten and reach higher.
 */
const effect = Skia.RuntimeEffect.Make(`
uniform shader soft;
uniform shader heavy;
uniform float2 size;
uniform float base;     // resting y of the slab top, just above the mic
uniform float level;    // 0 = resting at the mic, 1 = listening, >1 floods upward
uniform float spread;   // 0..1 how far the slab has widened out of the mic
uniform float time;     // seconds, for slow drift
uniform float breath;   // 0..1 breathing
uniform float beat;     // seconds since the latest word
uniform float beatPrev; // seconds since the word before it
uniform float voice;    // 0..1 envelope of the latest word

float wave(float x, float t) {
  if (t > 2.6) { return 0.0; }
  float dist = abs(x - size.x * 0.5);
  float front = t * 210.0;
  float fade = exp(-t * 1.5) * smoothstep(0.0, 0.05, t);
  // Broad, soft swells so the surface stays a smooth sine.
  float lub = exp(-pow((dist - front) / 64.0, 2.0));
  float dub = 0.55 * exp(-pow((dist - front + 110.0) / 56.0, 2.0));
  return (lub + dub) * fade;
}

float beatAt(float x) { return clamp(wave(x, beat) + 0.6 * wave(x, beatPrev), 0.0, 1.4); }

// Aurora wave: three slow undulations over a broad, low arch. Corners round off at the
// current reach, so the glass widens out of the mic.
float horizon(float x) {
  float lit = min(level, 1.0);
  float nx = x / size.x;
  float y = mix(base, size.y * 0.5, level) - size.y * 0.012 * breath * lit;
  // One broad travelling sine (~1.2 wavelengths across) with a single gentle harmonic.
  float wave = 0.8 * sin(nx * 7.5 - time * 0.42) + 0.2 * sin(nx * 3.1 + time * 0.27 + 1.1);
  float arch = 12.0 * sin(3.14159 * nx);
  float reach = spread * (size.x * 0.5 + 30.0);
  float inset = reach - abs(x - size.x * 0.5);
  float corner = 34.0 * exp(-max(inset, 0.0) / 26.0) + max(-inset, 0.0) * 6.0;
  return y - (arch + wave * (13.0 + 4.0 * voice)) * lit + corner - beatAt(x) * 6.0 * lit;
}

// Aurora curtains rising from the wave: vertical folds that sway slowly.
float curtain(float x, float above) {
  float nx = x / size.x;
  float folds = 0.5 + 0.5 * sin(nx * 18.0 + sin(nx * 5.0 + time * 0.3) * 2.2 + time * 0.18);
  folds = pow(folds, 1.6);
  float reachUp = 38.0 + 30.0 * (0.5 + 0.5 * sin(nx * 4.0 - time * 0.21)) + 28.0 * voice;
  return folds * exp(-above / reachUp) * smoothstep(0.0, 8.0, above + 2.0);
}

float glow(float2 p) {
  float2 uv = p / size;
  float2 asp = float2(size.x / size.y, 1.0);
  float t = time * 0.1;
  float2 a = (uv - float2(0.3 + 0.14 * sin(t * 1.3), 0.82)) * asp;
  float2 b = (uv - float2(0.72 + 0.12 * cos(t * 0.9 + 1.7), 0.74)) * asp;
  return smoothstep(0.05, 0.9, 0.8 * exp(-dot(a, a) * 14.0) + 0.7 * exp(-dot(b, b) * 18.0));
}

float halftone(float2 p, float amount) {
  float r = 0.46 * sqrt(clamp(amount, 0.0, 1.0));
  if (r < 0.06) { return 0.0; }
  return 1.0 - smoothstep(r - 0.08, r + 0.04, length(fract(p / 4.0) - 0.5));
}

half4 main(float2 p) {
  float lit = min(level, 1.0);
  float h = horizon(p.x);
  float d = p.y - h;
  float pulseHere = beatAt(p.x);
  half3 ink = mix(half3(0.3, 0.58, 0.86), half3(0.38, 0.44, 0.9), p.x / size.x);

  // Halftone band just inside the glass, swelling with the voice and under each beat.
  float band = exp(-pow((d - 20.0) / (18.0 + 10.0 * voice + 8.0 * pulseHere), 2.0));
  float dots = halftone(p, band * (0.16 + 0.2 * voice + 0.5 * pulseHere) * lit);

  // Above the glass: dithered aurora curtains plus a soft contact shadow.
  if (d < 0.0) {
    float above = -d;
    float light = curtain(p.x, above) * (0.55 + 0.35 * voice + 0.5 * pulseHere) * lit;
    half3 aurora = mix(mix(half3(0.32, 0.78, 0.8), half3(0.45, 0.5, 0.95), p.x / size.x), half3(0.72, 0.62, 0.98), clamp(above / 140.0, 0.0, 1.0));
    float speck = halftone(p, light * 0.9) * 0.5;
    float haze = light * 0.1;
    float shade = exp(-pow((d + 3.0) / 12.0, 2.0)) * (0.05 + 0.03 * pulseHere) * lit;
    float a = speck + haze;
    return half4(aurora * a, a + shade * (1.0 - a));
  }

  // Refraction is strongest just under the edge, and swells as a beat passes through.
  float slope = (horizon(p.x + 1.5) - horizon(p.x - 1.5)) / 3.0;
  float2 normal = normalize(float2(slope, -1.0));
  float bend = exp(-pow(d / 52.0, 2.0)) * (20.0 + 14.0 * pulseHere) * lit + 4.0;
  float2 q = p - normal * bend;

  float depth = clamp(d / (size.y * 0.42), 0.0, 1.0);
  float disperse = bend * 0.055;
  half4 body = mix(soft.eval(q), heavy.eval(q), depth);
  half r = mix(soft.eval(q + normal * disperse), heavy.eval(q + normal * disperse), depth).r;
  half b = mix(soft.eval(q - normal * disperse), heavy.eval(q - normal * disperse), depth).b;
  half3 c = half3(r, body.g, b);

  // Frosted body: lifted near the surface, cooler with depth, a whisper of drifting light.
  c = mix(c, half3(1.0), 0.17 * (1.0 - depth));
  c = mix(c, half3(0.9, 0.92, 0.952), 0.12 + 0.3 * depth);
  c = mix(c, ink, glow(p) * 0.06 * lit);
  c = mix(c, ink * 0.92, dots * 0.28);

  // Glass edge from light alone: a soft specular sheen and an inner glow, no drawn stroke.
  float sheen = 0.6 + 0.4 * sin(p.x / size.x * 3.0 - time * 0.35);
  c += half3(exp(-pow(d / 3.2, 2.0)) * (0.26 + 0.18 * pulseHere) * sheen);
  c += half3(exp(-pow((d - 12.0) / 20.0, 2.0)) * (0.06 + 0.05 * pulseHere));

  float alpha = smoothstep(0.0, 3.0, d);
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

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);

export type VeilState = "idle" | "listening" | "flood";

export function LiquidVeil({ backdrop, state, words = 0, reducedMotion, onUnavailable }: { backdrop: RefObject<View | null>; state: VeilState; words?: number; reducedMotion: boolean; onUnavailable: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const restY = height - Math.max(insets.bottom, 12) - 78;
  const [layers, setLayers] = useState<{ soft: SkImage; heavy: SkImage } | null>(null);
  const level = useSharedValue(0), spread = useSharedValue(0), time = useSharedValue(0), breath = useSharedValue(0);
  const beat = useSharedValue(10), beatPrev = useSharedValue(10), voice = useSharedValue(0);

  // Capture once per hold. The veil shows a frozen frame, so nothing re-renders underneath it.
  useEffect(() => {
    if (state !== "listening") return;
    let live = true;
    if (!backdrop.current) { onUnavailable(); return; }
    makeImageFromView(backdrop as RefObject<View>).then(image => {
      if (!live) return;
      const soft = image && blurred(image, width, height, 7), heavy = image && blurred(image, width, height, 24);
      if (soft && heavy) setLayers({ soft, heavy }); else onUnavailable();
    }).catch(() => live && onUnavailable());
    return () => { live = false; };
  }, [state]);

  useEffect(() => {
    if (state === "listening" && layers) {
      if (reducedMotion) { spread.set(1); level.set(withTiming(1, { duration: 200 })); return; }
      // The slab widens out of the mic as it lifts: no bounce, calm settle.
      spread.set(withTiming(1, { duration: 460, easing: EASE_OUT }));
      level.set(withDelay(60, withSpring(1, { duration: 560, dampingRatio: 1 })));
      time.set(0); time.set(withRepeat(withTiming(120, { duration: 120000, easing: Easing.linear }), -1));
      breath.set(withRepeat(withSequence(withTiming(1, { duration: 4000, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 6000, easing: Easing.inOut(Easing.sin) })), -1));
    } else if (state === "flood") {
      level.set(withTiming(2.1, { duration: 420, easing: EASE_IN_OUT }));
      breath.set(withTiming(0, { duration: 200 }));
    } else {
      // The slab sinks and narrows back into the mic.
      level.set(withTiming(0, { duration: 260, easing: EASE_IN_OUT }));
      spread.set(withTiming(0, { duration: 300, easing: EASE_IN_OUT }));
      breath.set(withTiming(0, { duration: 200 }));
    }
  }, [state, layers, reducedMotion]);

  // Each heard word: a double beat travels outward and the halftone band swells.
  useEffect(() => {
    if (state !== "listening" || !words) { voice.set(withTiming(0, { duration: 300 })); return; }
    if (reducedMotion) { voice.set(0.3); return; }
    const previous = beat.get();
    beatPrev.set(previous); beatPrev.set(withTiming(previous + 3, { duration: 3000, easing: Easing.linear }));
    beat.set(0); beat.set(withTiming(3, { duration: 3000, easing: Easing.linear }));
    voice.set(withSequence(withTiming(1, { duration: 140, easing: EASE_OUT }), withTiming(0.28, { duration: 900, easing: EASE_IN_OUT })));
  }, [words, state, reducedMotion]);
  useEffect(() => { if (state === "idle") { const t = setTimeout(() => setLayers(null), 480); return () => clearTimeout(t); } }, [state]);

  const uniforms = useDerivedValue(() => ({ size: [width, height], base: restY, level: level.value, spread: spread.value, time: time.value, breath: breath.value, beat: beat.value, beatPrev: beatPrev.value, voice: voice.value }));
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
