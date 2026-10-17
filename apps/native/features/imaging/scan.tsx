import { Canvas, Fill, ImageShader, Shader, Skia, useImage, type SkRuntimeEffect } from "@shopify/react-native-skia";
import * as Haptics from "expo-haptics";
import type { ImageSource } from "expo-image";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import Animated, { cancelAnimation, Easing, FadeIn, FadeOut, useDerivedValue, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Text } from "@/components/sona/text";
import { EASE_OUT } from "@/components/sona/motion";
import { type } from "@/components/sona/theme";
import { useAccessibleEffects } from "@/components/sona/ui";
import type { ScanState } from "./upload";

/**
 * The film while the image model reads it (after the web portal's halftone loader, in its ice-on-film tone): a beam
 * sweeps down the film and back, blooming softly; just behind it the film's own structure lights up (a Sobel pass on its
 * pixels) and fades back, and Bayer-dithered dots trail in its wake over a faint grid. Every mark is global: the reading
 * is text only, so nothing is placed on any part of the anatomy. A layer over the film, never a change to its pixels.
 */
// Compiles when first drawn, not at app start.
let compiled: SkRuntimeEffect | undefined;
const effect = () => compiled ??= Skia.RuntimeEffect.Make(`
uniform shader film;
uniform float2 res;
uniform float beam;
uniform float dir;
uniform float wake;
uniform float level;
uniform float pulse;
float lum(float2 p) { return dot(float3(film.eval(p).rgb), float3(0.299, 0.587, 0.114)); }
float bayer2(float2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(float2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
half4 main(float2 q) {
  float d = q.y - beam;
  float behind = -d * dir;
  float core = exp(-d * d) * level;
  float bloom = exp(-d * d / 320.0) * level;
  float trail = behind > 0.0 ? wake * level : 0.0;
  float edgeAmt = trail * exp(-behind / (0.22 * res.y)) + sin(3.14159 * pulse) * 0.6;
  float dotAmt = trail * exp(-behind / (0.07 * res.y));
  float edge = 0.0;
  if (edgeAmt > 0.01) {
    float n0 = lum(q + float2(-1.0, -1.0)), n1 = lum(q + float2(0.0, -1.0)), n2 = lum(q + float2(1.0, -1.0));
    float n3 = lum(q + float2(-1.0, 0.0)), n5 = lum(q + float2(1.0, 0.0));
    float n6 = lum(q + float2(-1.0, 1.0)), n7 = lum(q + float2(0.0, 1.0)), n8 = lum(q + float2(1.0, 1.0));
    float gx = (n2 + 2.0 * n5 + n8) - (n0 + 2.0 * n3 + n6);
    float gy = (n6 + 2.0 * n7 + n8) - (n0 + 2.0 * n1 + n2);
    // Only inside the film: its own border against the letterbox is not structure.
    float inside = float(film.eval(q - 1.5).a * film.eval(q + 1.5).a);
    edge = smoothstep(0.06, 0.4, length(float2(gx, gy))) * edgeAmt * inside;
  }
  float dots = 0.0;
  if (dotAmt > 0.01) {
    float2 idx = floor(q / 3.0);
    float2 cell = (idx + 0.5) * 3.0;
    float th = bayer4(idx) * 0.86 + 0.07;
    float dotm = 1.0 - smoothstep(0.5, 1.1, length(q - cell));
    dots = step(th, lum(cell) * dotAmt * 1.4) * dotm * 0.75;
  }
  float g = res.x / 8.0;
  float2 gp = abs(fract(q / g + 0.5) - 0.5) * g;
  float grid = (1.0 - smoothstep(0.0, 0.7, min(gp.x, gp.y))) * (0.05 + 0.2 * bloom) * level;
  float3 ice = float3(0.74, 0.9, 1.0), blue = float3(0.24, 0.47, 0.88);
  float glow = bloom * 0.28 + grid;
  float a = clamp(core * 0.9 + edge * 0.85 + dots + glow, 0.0, 1.0);
  float3 col = ice * (core * 0.9 + edge * 0.85 + dots) + mix(blue, ice, 0.4) * glow;
  return half4(half3(min(col, float3(a))), half(a));
}`)!;

/** One pass down the film; it comes back up at the same pace, slowing at each end. */
const SWEEP = 2400;

/**
 * Over a film (a card's tile or the viewer): the scan while `state` is "reading", one settling pulse and a light tap when
 * the model's reading lands ("read"), a quick fade when the read ends any other way. Mounted only from the first
 * "reading" until that settle ends, so nothing runs at rest; under Reduce Motion, the frame and its line only, still.
 * `filmStyle` carries the viewer's pan and zoom, so the pass stays on the pixels it lights.
 */
export function FilmScan({ source, state, filmStyle }: { source?: ImageSource | number; state: ScanState; filmStyle?: ComponentProps<typeof Animated.View>["style"] }) {
  const { reducedMotion } = useAccessibleEffects();
  const [on, setOn] = useState(state === "reading");
  const was = useRef(state);
  useEffect(() => {
    const before = was.current;
    was.current = state;
    if (state === "reading") { setOn(true); return; }
    // The tap fires as the pulse starts (the Beam's effect runs on this same commit).
    if (before === "reading" && state === "read" && process.env.EXPO_OS === "ios") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (reducedMotion) setOn(false);
  }, [state, reducedMotion]);
  if (!on) return null;
  return <View pointerEvents="none" style={{ position: "absolute", inset: 0 }}>
    {!reducedMotion && <Animated.View style={[{ position: "absolute", inset: 0 }, filmStyle]}><Beam source={source} state={state} onDone={() => setOn(false)} /></Animated.View>}
    {state === "reading" && <Frame reducedMotion={reducedMotion} />}
  </View>;
}

function Beam({ source, state, onDone }: { source?: ImageSource | number; state: ScanState; onDone: () => void }) {
  const image = useImage(typeof source === "number" ? source : source?.uri);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const phase = useSharedValue(0), level = useSharedValue(0), pulse = useSharedValue(0);
  useEffect(() => {
    if (state === "reading") {
      pulse.set(0);
      level.set(withTiming(1, { duration: 300, easing: EASE_OUT }));
      phase.set(0);
      phase.set(withRepeat(withTiming(2, { duration: SWEEP * 2, easing: Easing.linear }), -1));
      return;
    }
    // A cancelled settle (reading again) leaves it mounted: only one that runs to its end lets go.
    const done = (finished?: boolean) => { "worklet"; if (finished) scheduleOnRN(onDone); };
    cancelAnimation(phase);
    if (state === "read") {
      level.set(withTiming(0, { duration: 600, easing: EASE_OUT }));
      // One breath (sin π·p): the whole film's structure glows up and back down as the beam lets go.
      pulse.set(withTiming(1, { duration: 1100, easing: Easing.linear }, done));
    } else level.set(withTiming(0, { duration: 200, easing: EASE_OUT }, done));
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { cancelAnimation(phase); cancelAnimation(level); cancelAnimation(pulse); }, [phase, level, pulse]);
  const { width, height } = size;
  const uniforms = useDerivedValue(() => {
    const t = phase.get(), p = t < 1 ? t : 2 - t;
    // Part smoothstep: it eases into each end and turns there without dwelling; the trail fades toward the turn, so it never flips side abruptly.
    const eased = p + 0.6 * (p * p * (3 - 2 * p) - p);
    return { res: [width, height], beam: height * (-0.03 + 1.06 * eased), dir: t < 1 ? 1 : -1, wake: Math.min(1, 6 * p * (1 - p)), level: level.get(), pulse: pulse.get() };
  });
  return <View style={{ flex: 1 }} onLayout={e => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
    {image && width > 0 && <Canvas style={{ flex: 1 }}>
      <Fill><Shader source={effect()} uniforms={uniforms}><ImageShader image={image} fit="contain" tx="decal" ty="decal" rect={{ x: 0, y: 0, width, height }} /></Shader></Fill>
    </Canvas>}
  </View>;
}

const TICK = { position: "absolute", width: 14, height: 14, borderColor: "rgba(189,230,255,0.8)" } as const;
/** The instrument's frame while it reads: four corner ticks and one line saying what is happening. */
function Frame({ reducedMotion }: { reducedMotion: boolean }) {
  return <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(200).easing(EASE_OUT)} exiting={reducedMotion ? undefined : FadeOut.duration(200)} style={{ position: "absolute", inset: 0 }}>
    <View style={{ ...TICK, top: 8, left: 8, borderTopWidth: 1.5, borderLeftWidth: 1.5 }} />
    <View style={{ ...TICK, top: 8, right: 8, borderTopWidth: 1.5, borderRightWidth: 1.5 }} />
    <View style={{ ...TICK, bottom: 8, left: 8, borderBottomWidth: 1.5, borderLeftWidth: 1.5 }} />
    <View style={{ ...TICK, bottom: 8, right: 8, borderBottomWidth: 1.5, borderRightWidth: 1.5 }} />
    <View accessible accessibilityLiveRegion="polite" accessibilityLabel="Sona Vision is reading the film" style={{ position: "absolute", bottom: 12, alignSelf: "center", height: 26, paddingHorizontal: 11, borderRadius: 13, flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "rgba(20,28,40,0.62)", borderWidth: 1, borderColor: "rgba(255,255,255,0.16)" }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#BDE6FF" }} />
      <Text style={{ ...type.caption, fontWeight: "600", letterSpacing: 0.2, color: "#E8F5FF" }}>Sona Vision reading…</Text>
    </View>
  </Animated.View>;
}
