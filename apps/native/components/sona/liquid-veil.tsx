import { Canvas, Fill, ImageShader, Shader, Skia, TileMode, makeImageFromView, type SkImage, type SkRuntimeEffect } from "@shopify/react-native-skia";
import { useEffect, useRef, useState, type RefObject } from "react";
import { StyleSheet, useWindowDimensions, type View } from "react-native";
import { cancelAnimation, Easing, useDerivedValue, useFrameCallback, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EASE_IN_OUT, EASE_OUT } from "./motion";
import { follow, HISTORY, pushHistory, STEP_MS } from "./veil-signal";

/**
 * Aurora glass — Sona's listening surface.
 * Frosted liquid glass widens out of the mic and lifts; its top is a slow, glowing cloud edge
 * drawn by refraction and sheen, with dithered aurora curtains rising from it and a dithered
 * aurora blooming under it. It breathes on a 4 s in / 6 s out cycle; every heard word is a gust:
 * the edge swells and glides a little further while a band of light climbs the curtains. The live
 * voice lifts the crest, raises its lobes and ripples it, deepens and saturates the aurora, hangs
 * dithered columns of its last ~1.7 s from the crest (newest at the centre) and pulses a thin line
 * under it.
 *
 * The cloud edge and the aurora are adapted from "Voice Blob" by @mehdi_made (MIT licence):
 * value noise, an edge folded into billowed lobes, a vaporous rim and an fbm colour field that
 * saturates with depth and loudness.
 */
// Compiled on the first hold to talk, not at app start.
let compiled: SkRuntimeEffect | undefined;
const effect = () => compiled ??= Skia.RuntimeEffect.Make(`
uniform shader soft;
uniform shader heavy;
uniform float2 size;
uniform float base;     // resting y of the slab top, just above the mic
uniform float crestY;   // y where the listening crest rests (the crest prop)
uniform float level;    // 0 = resting at the mic, 1 = listening, >1 floods upward
uniform float spread;   // 0..1 how far the slab has widened out of the mic
uniform float time;     // seconds, for slow drift
uniform float breath;   // 0..1 breathing
uniform float voice;    // 0..1 gust envelope of the latest word
uniform float phase;    // extra wave travel, advanced a little on each word
uniform float flare;    // seconds since the latest word, for light climbing the curtains
uniform float exit;     // 0..1 while sinking back into the mic: softens the shape and fades it out
uniform float loud;     // 0..1 smoothed mic loudness (80 ms attack, 350 ms release)
uniform float hist[24]; // loudness history, newest first: the centre column, older ones toward the edges
uniform float still;    // 1 with Reduce Motion: nothing moves with the voice, loudness only changes opacity

// Loudness history at column f (0 = centre, 23 = edge), interpolated. Runtime effects may only index
// uniform arrays with loop indices, hence the loop.
float histAt(float f) {
  int k = int(floor(f));
  float a = 0.0, b = 0.0;
  for (int i = 0; i < 24; i++) { if (i == k) { a = hist[i]; } if (i == k + 1) { b = hist[i]; } }
  return mix(a, b, fract(f));
}

// exp(-x²) without pow(): pow() of a negative base is undefined on the GPU.
float gauss(float x) { return exp(-x * x); }

// Value noise for the cloud edge and the aurora, on a sin-free hash (Dave Hoskins) that holds up in fp32.
float hash(float n) { n = fract(n * 0.1031); n *= n + 33.33; n *= n + n; return fract(n); }

// 2D value noise and its x-derivative, so the crest's slope (for refraction) needs no extra evaluations.
float2 noisedx(float2 p) {
  float2 i = floor(p), f = p - i, u = f * f * (3.0 - 2.0 * f);
  float n = i.x + i.y * 57.0;
  float a = hash(n), b = hash(n + 1.0), c = hash(n + 57.0), e = hash(n + 58.0);
  return float2(mix(a + (b - a) * u.x, c + (e - c) * u.x, u.y), mix(b - a, e - c, u.y) * 6.0 * f.x * (1.0 - f.x));
}

float noise(float2 p) {
  float2 i = floor(p), f = p - i, u = f * f * (3.0 - 2.0 * f);
  float n = i.x + i.y * 57.0;
  return mix(mix(hash(n), hash(n + 1.0), u.x), mix(hash(n + 57.0), hash(n + 58.0), u.x), u.y);
}

// Where the crest sits for a level: the mic at 0, the listening rest at 1, then on to the flood height.
float lift(float lv) {
  return lv <= 1.0 ? mix(base, crestY, lv) : mix(crestY, base + (size.y * 0.5 - base) * 2.1, (lv - 1.0) / 1.1);
}

// The crest: its y at x, and its slope. A cloud edge rather than a sine: two broad noise layers (about 1.5 and
// 3.3 cells across) drift in opposite directions and slowly morph, each folded into rounded lobes with soft
// creases between (cloud, not water), over a broad low arch. Calm at rest; louder speech raises the lobes.
// Corners round off at the current reach, so the glass widens out of the mic.
float2 horizon(float x) {
  float lit = min(level, 1.0);
  float nx = x / size.x;
  float y = lift(level) - size.y * 0.012 * breath * lit;
  float move = loud * (1.0 - still);
  float2 a = noisedx(float2(nx * 1.5 + time * 0.09 + phase * 0.16, time * 0.05));
  float2 b = noisedx(float2(nx * 3.3 - time * 0.07 - phase * 0.06, 4.7 + time * 0.04));
  float za = a.x * 2.0 - 1.0, zb = b.x * 2.0 - 1.0, la = sqrt(za * za + 0.008), lb = sqrt(zb * zb + 0.008);
  // Heights in pt (up is positive) and their slopes per unit of nx; 0.62 is the lobes' mean. Each word is a
  // gust: the cloud and the arch swell, then ease back.
  float amp = (38.0 + 22.0 * move) * (1.0 + 0.4 * voice);
  float h = (la + 0.8 * lb - 0.62) * amp;
  float dh = (za / la * 3.0 * a.y + zb / lb * 5.28 * b.y) * amp;
  float s = sin(3.14159 * nx), cs = 3.14159 * cos(3.14159 * nx);
  h += 12.0 * s * (1.0 + 0.25 * voice);
  dh += 12.0 * cs * (1.0 + 0.25 * voice);
  // The crest lifts with loudness and carries small travelling ripples whose height follows it; both are
  // capped (16 + 5 pt) so the words above stay clear, and both stop with Reduce Motion.
  float k1 = nx * 26.0 - time * 3.2, k2 = nx * 41.0 - time * 2.1 + 0.8;
  float ripple = 0.7 * sin(k1) + 0.3 * sin(k2);
  h += move * (16.0 + 5.0 * ripple * s);
  dh += move * 5.0 * ((18.2 * cos(k1) + 12.3 * cos(k2)) * s + ripple * cs);
  // While exiting, the corners widen and the walls slope gently, so the narrowing glass
  // becomes a soft bell rather than a pointed cone.
  float off = x - size.x * 0.5, inset = spread * (size.x * 0.5 + 30.0) - abs(off);
  float radius = mix(26.0, 90.0, exit), wall = mix(6.0, 1.1, exit);
  float bow = mix(34.0, 60.0, exit) * exp(-max(inset, 0.0) / radius);
  return float2(y - h * lit + bow + max(-inset, 0.0) * wall, -dh * lit / size.x + sign(off) * (inset > 0.0 ? bow / radius : wall));
}

// Aurora curtains rising from the wave: vertical folds that sway slowly.
float curtain(float x, float above, float column) {
  float nx = x / size.x;
  float folds = 0.5 + 0.5 * sin(nx * 18.0 + sin(nx * 5.0 + time * 0.3) * 2.2 + time * 0.18);
  folds = pow(max(folds, 0.0), 1.6);
  float reachUp = 38.0 + 30.0 * (0.5 + 0.5 * sin(nx * 4.0 - time * 0.21)) + 28.0 * voice + 34.0 * column * (1.0 - still);
  return folds * exp(-above / reachUp) * smoothstep(0.0, 8.0, above + 2.0);
}

float halftone(float2 p, float amount) {
  float r = 0.46 * sqrt(clamp(amount, 0.0, 1.0));
  if (r < 0.06) { return 0.0; }
  return 1.0 - smoothstep(r - 0.08, r + 0.04, length(fract(p / 4.0) - 0.5));
}

half4 main(float2 p) {
  float lit = min(level, 1.0);
  float2 crest = horizon(p.x);
  float d = p.y - crest.x;
  half3 ink = mix(half3(0.3, 0.58, 0.86), half3(0.38, 0.44, 0.9), p.x / size.x);

  // Voice columns, mirrored about the centre (newest there): each is a dithered streak that hangs from the
  // crest into the glass and climbs back up its curtain, its reach following that moment's loudness.
  float cx = abs(p.x - size.x * 0.5);
  float f = min(cx / (size.x * 0.5), 1.0) * 23.0;
  float column = (d > -200.0 && d < 140.0) ? histAt(floor(f + 0.5)) : 0.0;
  float streak = (1.0 - smoothstep(0.3, 0.8, abs(fract(f + 0.5) - 0.5) * 2.0)) * lit * (1.0 - exit);
  float hang = mix(10.0 + 72.0 * column, 34.0, still);
  float streaks = streak * (1.0 - smoothstep(hang * 0.55, hang, d)) * smoothstep(-2.0, 6.0, d) * (0.12 + 0.4 * mix(column, loud, still));
  float vanish = 1.0 - smoothstep(0.15, 0.9, exit);
  float loudM = loud * (1.0 - still);
  // The crest glows rather than cuts: a soft band of the aurora's light straddling it, brighter with the voice.
  float glow = gauss(d / (8.0 + 6.0 * loudM)) * (0.2 + 0.2 * loud + 0.1 * voice) * lit * vanish;
  half3 glowCol = mix(half3(0.66, 0.76, 1.0), half3(0.76, 0.68, 1.0), p.x / size.x);

  // Above the glass: dithered aurora curtains over the glow.
  if (d < 0.0) {
    float above = -d;
    // A band of light climbs the curtains after each word and fades near their tips.
    float climb = gauss((above - flare * 120.0) / 24.0) * exp(-flare * 1.4) * smoothstep(0.0, 0.08, flare);
    float light = curtain(p.x, above, column) * (0.55 + 0.3 * voice + 0.35 * loud + 1.3 * climb) * lit;
    half3 aurora = mix(mix(half3(0.32, 0.78, 0.8), half3(0.45, 0.5, 0.95), p.x / size.x), half3(0.72, 0.62, 0.98), clamp(above / 140.0, 0.0, 1.0));
    float speck = halftone(p, light * 0.9 * (1.0 - exit)) * 0.5;
    float a = (speck + light * 0.1) * vanish;
    return half4(aurora * a + glowCol * glow * (1.0 - a), a + glow * (1.0 - a));
  }

  // Refraction is strongest just under the edge, and deepens with each gust.
  float2 normal = normalize(float2(crest.y, -1.0));
  float bend = gauss(d / 52.0) * (20.0 + 8.0 * voice) * lit + 4.0;
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

  // Frosted body: lifted near the surface, cooler with depth.
  c = mix(c, half3(1.0), 0.17 * (1.0 - depth));
  c = mix(c, half3(0.9, 0.92, 0.952), 0.12 + 0.3 * depth);

  // The aurora: a bloom of azure into violet, with a faint teal hint, hanging under the crest in the upper glass
  // (above the words). Two drifting fbm layers set its density and lobe its lower edge; it saturates away from
  // the rim and with loudness, reaches further down as the voice rises and breathes when quiet. It shows as a
  // light wash and, mostly, as halftone dots sized by its density: subtle at rest, alive with the voice.
  float reach = 62.0 + 36.0 * loudM + 10.0 * breath * (1.0 - loudM) + 10.0 * voice;
  float aur = 0.0;
  half3 aurCol = ink;
  if (d < 1.8 * reach) {
    float2 uv = float2(p.x / size.x, 1.0 - p.y / size.y);
    float2 q2 = float2(uv.x * 2.4 - time * 0.08, uv.y * 2.6 + time * 0.03);
    float bulk = 0.0, amp = 0.55;
    for (int i = 0; i < 3; i++) { bulk += amp * noise(q2); q2 = q2 * 2.03 + float2(13.7, 7.31); amp *= 0.5; }
    float2 w = float2(uv.x * 5.2 + time * 0.05, uv.y * 5.5 - time * 0.02);
    float wisp = 0.55 * noise(w) + 0.275 * noise(w * 2.03 + float2(13.7, 7.31));
    float dens = 0.4 * (bulk - 0.48) + 0.22 * (wisp - 0.41);
    float fade = 1.0 - smoothstep(0.45 * reach, 1.45 * reach, d + dens * 2.0 * reach);
    aur = smoothstep(0.0, 10.0, d) * fade * smoothstep(-0.05, 0.08, dens) * lit * (1.0 - exit);
    float deep = clamp(d / reach, 0.0, 1.0) * (0.55 + 0.45 * loud);
    half3 hue = mix(half3(0.14, 0.36, 0.8), half3(0.61, 0.48, 1.0), smoothstep(0.25, 0.85, uv.x + 1.2 * dens));
    aurCol = mix(half3(0.5, 0.63, 1.0), hue, clamp(deep * 1.4, 0.0, 1.0));
    aurCol = mix(aurCol, half3(0.25, 0.74, 0.78), 0.3 * (1.0 - deep) * (1.0 - uv.x));
    c = mix(c, aurCol, aur * (0.08 + 0.17 * loud));
  }

  // One dot per cell for the halftone band just inside the edge (swelling with each gust, brightening with
  // loudness), the voice columns and the aurora; its colour and strength blend by their shares.
  float band = gauss((d - 20.0) / (18.0 + 12.0 * voice + 8.0 * loud));
  float rimAmt = band * (0.16 + 0.34 * voice + 0.3 * loud) * lit * (1.0 - exit) + streaks;
  float aurAmt = aur * mix(0.28 + 0.6 * loudM + 0.15 * voice, 0.45, still);
  float total = max(rimAmt + aurAmt, 0.0001);
  float dots = halftone(p, rimAmt + aurAmt);
  half3 dotCol = (ink * 0.92 * rimAmt + aurCol * aurAmt) / total;
  c = mix(c, dotCol, dots * (rimAmt * (0.28 + 0.1 * loud) + aurAmt * (0.3 + 0.3 * loud)) / total);

  // A thin voice line under the crest, centred on the mic: the loudness history, newest in the middle,
  // ripples outward from the centre. Flat with Reduce Motion, where only its opacity follows the voice.
  float y0 = lift(min(level, 1.0)) + 40.0;
  if (abs(p.y - y0) < 16.0) {
    float sx = (p.x / size.x - 0.5) / 0.2;
    float span = exp(-sx * sx);
    float amp = histAt(min(cx / (size.x * 0.3), 1.0) * 23.0) * 9.0 * span * (1.0 - still);
    float k = cx * 0.11 - time * 5.0;
    float tilt = amp * 0.11 * cos(k);
    float dist = abs(p.y - y0 - amp * sin(k)) / sqrt(1.0 + tilt * tilt);
    float stroke = (1.0 - smoothstep(0.35, 1.3, dist)) * (0.12 + 0.3 * loud) * span * lit * (1.0 - exit);
    c = mix(c, ink * 0.82, stroke);
  }

  // Glass edge from light alone: a soft specular sheen and an inner glow, no drawn stroke.
  float sheen = 0.6 + 0.4 * sin(p.x / size.x * 3.0 - time * 0.35);
  c += half3(gauss(d / 6.0) * (0.2 + 0.1 * voice) * sheen);
  c += half3(gauss((d - 12.0) / 20.0) * (0.06 + 0.04 * voice));

  // A vaporous rim that fades the glass in under the glow, wider and fading out while exiting, so it ends as a
  // soft haze.
  float alpha = smoothstep(0.0, 14.0 + 16.0 * exit, d) * vanish;
  return half4(glowCol * glow + c * alpha * (1.0 - glow), glow + alpha * (1.0 - glow));
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

export function LiquidVeil({ backdrop, state, armed = false, words = 0, voiceLevel, crest = 0.5, reducedMotion, onUnavailable }: { backdrop: RefObject<View | null>; state: VeilState; /** Finger is down on the mic: capture early so the veil is ready. */ armed?: boolean; words?: number; /** Live voice loudness 0..1 (UI thread): lifts and ripples the crest, deepens the aurora, drives the columns and the voice line. */ voiceLevel?: SharedValue<number>; /** How high the listening crest rests, as a fraction of the screen height from the bottom (mid-screen by default); a full-screen page can keep it lower. */ crest?: number; reducedMotion: boolean; onUnavailable: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const restY = height - Math.max(insets.bottom, 12) - 78;
  const [layers, setLayers] = useState<{ soft: SkImage; heavy: SkImage } | null>(null);
  const level = useSharedValue(0), spread = useSharedValue(0), time = useSharedValue(0), breath = useSharedValue(0);
  const voice = useSharedValue(0), phase = useSharedValue(0), flare = useSharedValue(10);
  const exit = useSharedValue(0);
  const lastGust = useRef(0);
  // The voice, smoothed on the UI thread (80 ms attack, 350 ms release), and a column of it every 70 ms.
  const loud = useSharedValue(0), history = useSharedValue<number[]>(Array(HISTORY).fill(0)), sinceStep = useSharedValue(0);
  const signal = useFrameCallback(({ timeSincePreviousFrame }) => {
    const dt = timeSincePreviousFrame ?? 16;
    const env = follow(loud.get(), voiceLevel?.get() ?? 0, dt);
    loud.set(env);
    sinceStep.set(sinceStep.get() + dt);
    if (sinceStep.get() < STEP_MS) return;
    sinceStep.set(0);
    history.modify(h => { "worklet"; return pushHistory(h, env); });
  }, false);

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

  // Follow the voice only while listening; it falls quiet as the glass floods or sinks back.
  useEffect(() => {
    if (state === "listening" && layers && voiceLevel) {
      cancelAnimation(loud); loud.set(0); history.set(Array(HISTORY).fill(0)); sinceStep.set(0); signal.setActive(true);
      return;
    }
    signal.setActive(false);
    loud.set(withTiming(0, { duration: 350, easing: EASE_OUT }));
  }, [state, layers, voiceLevel]);

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
  useEffect(() => () => { [level, spread, time, breath, voice, phase, flare, exit, loud].forEach(v => cancelAnimation(v)); }, []);

  const uniforms = useDerivedValue(() => ({ size: [width, height], base: restY, crestY: height * (1 - crest), level: level.value, spread: spread.value, time: time.value, breath: breath.value, voice: voice.value, phase: phase.value, flare: flare.value, exit: exit.value, loud: loud.get(), hist: history.get(), still: reducedMotion ? 1 : 0 }));
  if (!layers) return null;
  return <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
    <Fill>
      <Shader source={effect()} uniforms={uniforms}>
        <ImageShader image={layers.soft} fit="fill" tx="clamp" ty="clamp" rect={{ x: 0, y: 0, width, height }} />
        <ImageShader image={layers.heavy} fit="fill" tx="clamp" ty="clamp" rect={{ x: 0, y: 0, width, height }} />
      </Shader>
    </Fill>
  </Canvas>;
}
