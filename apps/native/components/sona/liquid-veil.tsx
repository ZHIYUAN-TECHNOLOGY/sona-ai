import { Canvas, Fill, ImageShader, Shader, Skia, TileMode, makeImageFromView, type SkImage } from "@shopify/react-native-skia";
import { useEffect, useRef, useState, type RefObject } from "react";
import { StyleSheet, useWindowDimensions, type View } from "react-native";
import { cancelAnimation, Easing, useDerivedValue, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EASE_IN_OUT, EASE_OUT } from "./motion";

/**
 * Aurora glass — Sona's listening surface.
 * Frosted liquid glass widens out of the mic and lifts; its top is a slow aurora wave drawn
 * only by refraction and sheen, with dithered aurora curtains rising from it. It breathes on
 * a 4 s in / 6 s out cycle; every heard word is a gust: the wave swells and glides a little
 * further while a band of light climbs the curtains.
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
uniform float voice;    // 0..1 gust envelope of the latest word
uniform float phase;    // extra wave travel, advanced a little on each word
uniform float flare;    // seconds since the latest word, for light climbing the curtains
uniform float exit;     // 0..1 while sinking back into the mic: softens the shape and fades it out

// Aurora wave: a soft travelling sine over a broad, low arch. Corners round off at the
// current reach, so the glass widens out of the mic.
float horizon(float x) {
  float lit = min(level, 1.0);
  float nx = x / size.x;
  float y = mix(base, size.y * 0.5, level) - size.y * 0.012 * breath * lit;
  // One broad travelling sine (~1.2 wavelengths across) with a single gentle harmonic.
  float wave = 0.8 * sin(nx * 7.5 - time * 0.42 - phase) + 0.2 * sin(nx * 3.1 + time * 0.27 + 1.1 + phase * 0.4);
  float arch = 12.0 * sin(3.14159 * nx);
  float reach = spread * (size.x * 0.5 + 30.0);
  float inset = reach - abs(x - size.x * 0.5);
  // While exiting, the corners widen and the walls slope gently, so the narrowing glass
  // becomes a soft bell rather than a pointed cone.
  float radius = mix(26.0, 90.0, exit), wall = mix(6.0, 1.1, exit);
  float corner = mix(34.0, 60.0, exit) * exp(-max(inset, 0.0) / radius) + max(-inset, 0.0) * wall;
  // Each word is a gust: the whole wave swells in amplitude, then eases back.
  return y - (arch * (1.0 + 0.25 * voice) + wave * 13.0 * (1.0 + 0.4 * voice)) * lit + corner;
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
  half3 ink = mix(half3(0.3, 0.58, 0.86), half3(0.38, 0.44, 0.9), p.x / size.x);

  // Halftone band just inside the glass, swelling with each gust.
  float band = exp(-pow((d - 20.0) / (18.0 + 12.0 * voice), 2.0));
  float dots = halftone(p, band * (0.16 + 0.34 * voice) * lit * (1.0 - exit));
  float vanish = 1.0 - smoothstep(0.15, 0.9, exit);

  // Above the glass: dithered aurora curtains plus a soft contact shadow.
  if (d < 0.0) {
    float above = -d;
    // A band of light climbs the curtains after each word and fades near their tips.
    float climb = exp(-pow((above - flare * 120.0) / 24.0, 2.0)) * exp(-flare * 1.4) * smoothstep(0.0, 0.08, flare);
    float light = curtain(p.x, above) * (0.55 + 0.3 * voice + 1.3 * climb) * lit;
    half3 aurora = mix(mix(half3(0.32, 0.78, 0.8), half3(0.45, 0.5, 0.95), p.x / size.x), half3(0.72, 0.62, 0.98), clamp(above / 140.0, 0.0, 1.0));
    float speck = halftone(p, light * 0.9 * (1.0 - exit)) * 0.5;
    float haze = light * 0.1;
    float shade = exp(-pow((d + 3.0) / 12.0, 2.0)) * (0.05 + 0.02 * voice) * lit;
    float a = speck + haze;
    a *= vanish; shade *= vanish;
    return half4(aurora * a, a + shade * (1.0 - a));
  }

  // Refraction is strongest just under the edge, and deepens with each gust.
  float slope = (horizon(p.x + 1.5) - horizon(p.x - 1.5)) / 3.0;
  float2 normal = normalize(float2(slope, -1.0));
  float bend = exp(-pow(d / 52.0, 2.0)) * (20.0 + 8.0 * voice) * lit + 4.0;
  float2 q = p - normal * bend;

  float depth = clamp(d / (size.y * 0.42), 0.0, 1.0);
  float disperse = bend * 0.055;
  // Deep in the body only the heavy blur has weight, so skip the soft samples there (same result).
  half4 body; half r; half b;
  if (depth >= 1.0) {
    body = heavy.eval(q); r = heavy.eval(q + normal * disperse).r; b = heavy.eval(q - normal * disperse).b;
  } else {
    body = mix(soft.eval(q), heavy.eval(q), depth);
    r = mix(soft.eval(q + normal * disperse), heavy.eval(q + normal * disperse), depth).r;
    b = mix(soft.eval(q - normal * disperse), heavy.eval(q - normal * disperse), depth).b;
  }
  half3 c = half3(r, body.g, b);

  // Frosted body: lifted near the surface, cooler with depth, a whisper of drifting light.
  c = mix(c, half3(1.0), 0.17 * (1.0 - depth));
  c = mix(c, half3(0.9, 0.92, 0.952), 0.12 + 0.3 * depth);
  c = mix(c, ink, glow(p) * 0.06 * lit);
  c = mix(c, ink * 0.92, dots * 0.28);

  // Glass edge from light alone: a soft specular sheen and an inner glow, no drawn stroke.
  float sheen = 0.6 + 0.4 * sin(p.x / size.x * 3.0 - time * 0.35);
  c += half3(exp(-pow(d / 3.2, 2.0)) * (0.26 + 0.12 * voice) * sheen);
  c += half3(exp(-pow((d - 12.0) / 20.0, 2.0)) * (0.06 + 0.04 * voice));

  // Feathered edge and fading body while exiting, so it ends as a soft haze.
  float alpha = smoothstep(0.0, 3.0 + 26.0 * exit, d) * vanish;
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

export function LiquidVeil({ backdrop, state, armed = false, words = 0, reducedMotion, onUnavailable }: { backdrop: RefObject<View | null>; state: VeilState; /** Finger is down on the mic: capture early so the veil is ready. */ armed?: boolean; words?: number; reducedMotion: boolean; onUnavailable: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const restY = height - Math.max(insets.bottom, 12) - 78;
  const [layers, setLayers] = useState<{ soft: SkImage; heavy: SkImage } | null>(null);
  const level = useSharedValue(0), spread = useSharedValue(0), time = useSharedValue(0), breath = useSharedValue(0);
  const voice = useSharedValue(0), phase = useSharedValue(0), flare = useSharedValue(10);
  const exit = useSharedValue(0);
  const lastGust = useRef(0);

  // Capture once per hold, starting on touch-down so the frozen frame is ready when listening begins.
  const capturing = useRef(false), current = useRef(layers); current.current = layers;
  const wanted = useRef(false); wanted.current = state !== "idle" || armed;
  useEffect(() => {
    if ((state !== "listening" && !armed) || current.current || capturing.current) return;
    if (!backdrop.current) { onUnavailable(); return; }
    capturing.current = true;
    makeImageFromView(backdrop as RefObject<View>).then(image => {
      const soft = image && blurred(image, width, height, 7), heavy = image && blurred(image, width, height, 24);
      image?.dispose();
      if (!soft || !heavy) { onUnavailable(); return; }
      // The touch may have ended while capturing; don't keep images nobody will show.
      if (wanted.current) setLayers({ soft, heavy }); else { soft.dispose(); heavy.dispose(); }
    }).catch(() => onUnavailable()).finally(() => { capturing.current = false; });
  }, [state, armed]);
  // Free the screen-sized GPU images as soon as they are replaced or cleared.
  useEffect(() => () => { layers?.soft.dispose(); layers?.heavy.dispose(); }, [layers]);

  useEffect(() => {
    if (state === "listening" && layers) {
      cancelAnimation(exit); exit.set(0);
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
      // The slab sinks and narrows back into the mic; stop the drift clock once it is gone.
      cancelAnimation(time);
      exit.set(layers ? withTiming(1, { duration: 300, easing: EASE_OUT }) : 1);
      level.set(withTiming(0, { duration: 260, easing: EASE_IN_OUT }));
      spread.set(withTiming(0, { duration: 300, easing: EASE_IN_OUT }));
      breath.set(withTiming(0, { duration: 200 }));
    }
  }, [state, layers, reducedMotion]);

  // Each heard word is a gust: the wave swells and glides a little further, light climbs the curtains.
  useEffect(() => {
    if (state !== "listening" || !words) { voice.set(withTiming(0, { duration: 300 })); return; }
    if (reducedMotion) { voice.set(0.3); return; }
    voice.set(withSequence(withTiming(1, { duration: 220, easing: EASE_OUT }), withTiming(0.2, { duration: 800, easing: EASE_IN_OUT })));
    // Speech lands several words a second; let each gust's light finish climbing before the next.
    const now = Date.now();
    if (now - lastGust.current < 450) return;
    lastGust.current = now;
    phase.set(withTiming(phase.get() + 0.7, { duration: 900, easing: EASE_OUT }));
    flare.set(0); flare.set(withTiming(2.2, { duration: 2200, easing: Easing.linear }));
  }, [words, state, reducedMotion]);
  useEffect(() => { if (state === "idle" && !armed) { const t = setTimeout(() => setLayers(null), 480); return () => clearTimeout(t); } }, [state, armed]);
  useEffect(() => () => { [level, spread, time, breath, voice, phase, flare, exit].forEach(v => cancelAnimation(v)); }, []);

  const uniforms = useDerivedValue(() => ({ size: [width, height], base: restY, level: level.value, spread: spread.value, time: time.value, breath: breath.value, voice: voice.value, phase: phase.value, flare: flare.value, exit: exit.value }));
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
