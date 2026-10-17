import { PressScale } from "@/components/sona/parts";
import { Canvas, Fill, Shader, Skia } from "@shopify/react-native-skia";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { useEffect, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View, type ViewStyle } from "react-native";
import Animated, { cancelAnimation, Easing, LinearTransition, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { HalftoneGlint } from "@/components/sona/halftone-shimmer";
import { EASE_IN_OUT, EASE_OUT, LAYOUT_SPRING, riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type, radius } from "@/components/sona/theme";
import { Icon, useAccessibleEffects } from "@/components/sona/ui";

/** The page scanner's shared Sona glass pieces: the camera screen (scan-camera) and the scanned-page rows after it. */
export const TEAL = "#2FB89A";
export const EASE = Easing.bezier(0.23, 1, 0.32, 1);
export const SHEET_SPRING = { damping: 16, stiffness: 190, mass: 1 };
export type Page = { id: number; uri?: string };

/** Sona's blue halftone band, sweeping bottom → top across the page being read. An overlay only: the photo's pixels are never tinted. */
const sweepEffect = Skia.RuntimeEffect.Make(`
uniform float2 res;
uniform float p;
half4 main(float2 q) {
  float amt = sin(3.14159 * clamp(p, 0.0, 1.0));
  if (amt < 0.02) { return half4(0.0); }
  float y = 1.0 - q.y / res.y;
  float band = exp(-pow((y - mix(-0.2, 1.2, p)) / 0.14, 2.0));
  float r = 0.5 * sqrt(band * amt);
  if (r < 0.06) { return half4(0.0); }
  float dotShape = 1.0 - smoothstep(r - 0.08, r + 0.04, length(fract(q / 7.0) - 0.5));
  half3 hue = mix(half3(0.24, 0.43, 1.0), half3(0.4, 0.69, 1.0), y);
  float alpha = dotShape * 0.85;
  return half4(hue * alpha, alpha);
}`)!;


export function Sweep({ width, height, progress }: { width: number; height: number; progress: SharedValue<number> }) {
  const uniforms = useDerivedValue(() => ({ res: [width, height], p: progress.value }));
  return <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}><Fill><Shader source={sweepEffect} uniforms={uniforms} /></Fill></Canvas>;
}


const SWEEP = { duration: 1100, easing: EASE_IN_OUT };
const SLOT = 1300; // one sweep plus a breath before the next page
const SWEPT = 4; // ponytail: only the pages in view sweep; the rest of a long scan sits still.

/**
 * The doctor's scanned pages in a row, with Sona's halftone band sweeping up them. `arrive`: once
 * each as the scan lands, 120 ms apart. `reading`: one page after another, round the row, while
 * Sona reads them; on `still` a pass in flight finishes quickly. Reduce Motion shows the pages still.
 */
export function ScannedPages({ pages, pass, width = 96 }: { pages: string[]; pass: "arrive" | "reading" | "still"; width?: number }) {
  const { reducedMotion } = useAccessibleEffects();
  const height = Math.round(width * 4 / 3);
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
    {pages.map((uri, i) => <ScannedPage key={uri} uri={uri} i={i} n={Math.min(pages.length, SWEPT)} width={width} height={height} pass={reducedMotion ? "still" : pass} />)}
  </ScrollView>;
}

function ScannedPage({ uri, i, n, width, height, pass }: { uri: string; i: number; n: number; width: number; height: number; pass: "arrive" | "reading" | "still" }) {
  const read = useSharedValue(0);
  useEffect(() => {
    if (i >= SWEPT) return;
    if (pass === "arrive") read.set(withDelay(200 + i * 120, withTiming(1, SWEEP)));
    else if (pass === "reading") read.set(withDelay(i * SLOT, withRepeat(withSequence(withTiming(1, SWEEP), withTiming(0, { duration: 0 }), withDelay(n * SLOT - SWEEP.duration, withTiming(0, { duration: 0 }))), -1)));
    else { cancelAnimation(read); const p = read.get(); if (p > 0 && p < 1) read.set(withTiming(1, { duration: 240, easing: EASE_OUT })); }
  }, [pass]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => cancelAnimation(read), [read]);
  return <Animated.View entering={pass === "arrive" ? riseIn({ delay: i * 60, distance: 8, scale: 0.96, duration: 320 }) : undefined}
    style={{ width, height, borderRadius: radius.control, borderCurve: "continuous", overflow: "hidden", borderWidth: 1, borderColor: palette.line, backgroundColor: palette.white }}>
    <Image source={{ uri }} accessibilityLabel={`Scanned page ${i + 1}`} contentFit="cover" style={StyleSheet.absoluteFill} />
    {i < SWEPT && <Sweep width={width} height={height} progress={read} />}
  </Animated.View>;
}

/** Light glass for floating chrome over the camera: near-white frost so it reads white, not grey, over a dark room; a bright rim and a soft lift. */
export function LightGlass({ children, style, radius }: { children?: ReactNode; style?: ViewStyle; radius: number }) {
  const { reducedTransparency } = useAccessibleEffects();
  const shell = { borderRadius: radius, borderCurve: "continuous", overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.9)", boxShadow: "0 8px 24px rgba(8,12,20,0.24)" } as ViewStyle;
  if (reducedTransparency) return <View style={[shell, { backgroundColor: palette.surface }, style]}>{children}</View>;
  return <View style={shell}>
    <BlurView tint="extraLight" intensity={80} style={[{ backgroundColor: "rgba(255,255,255,0.86)" }, style]}>{children}</BlurView>
  </View>;
}

/**
 * The way on: an ink capsule holding the captured pages as overlapping thumbnails, then "Review" and
 * the count. It springs in with the first page and widens as pages are added.
 */
export function ReviewCapsule({ pages, label, onPress, title = "Review" }: { pages: Page[]; label: string; onPress: () => void; title?: string }) {
  const { reducedMotion } = useAccessibleEffects();
  const pop = useSharedValue(reducedMotion ? 1 : 0.4);
  useEffect(() => { if (!reducedMotion) { pop.set(0.86); pop.set(withSpring(1, { damping: 11, stiffness: 260 })); } }, [pages.length, reducedMotion]); // eslint-disable-line react-hooks/exhaustive-deps
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const shown = pages.slice(-3);
  return <Animated.View layout={reducedMotion ? undefined : LinearTransition.springify().duration(LAYOUT_SPRING.duration).dampingRatio(0.8)} style={[{ transformOrigin: "left center" } as ViewStyle, popStyle]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}, ${label}`} onPress={onPress}>{({ pressed }) => <PressScale pressed={pressed} style={{ height: 50, paddingLeft: 8, paddingRight: 14, borderRadius: 25, overflow: "hidden", flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: palette.ink, boxShadow: "0 6px 16px rgba(24,32,48,0.22)" }}>
      <HalftoneGlint width={60} height={50} origin={[8, 2]} reach={[54, 44]} pitch={3} strength={0.6} tint={[0.62, 0.78, 1]} hueShift={0.6} style={{ top: 0, left: 0 }} />
      <View style={{ flexDirection: "row" }}>
        {shown.map((p, i) => <View key={p.id} style={{ width: 25, height: 34, marginLeft: i ? -15 : 0, borderRadius: 5, overflow: "hidden", backgroundColor: "#F6F3EC", borderWidth: 1.5, borderColor: palette.white, transform: [{ rotate: `${(i - shown.length + 1) * 6}deg` }] }}>
          {p.uri ? <Image source={{ uri: p.uri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <PageLines small />}
        </View>)}
      </View>
      <View>
        <Text style={{ ...type.subhead, fontWeight: "600", color: palette.white }}>{title}</Text>
        <Text style={{ ...type.caption, fontWeight: "500", fontVariant: ["tabular-nums"], color: "rgba(255,255,255,0.65)" }}>{label}</Text>
      </View>
      <Icon name="chevron.right" size={11} color="rgba(255,255,255,0.8)" />
    </PressScale>}</Pressable>
  </Animated.View>;
}

/** One corner bracket of the page guide: thin white while waiting, teal once a page is locked. */
export function Corner({ corner, locked }: { corner: "tl" | "tr" | "bl" | "br"; locked: boolean }) {
  const top = corner[0] === "t", left = corner[1] === "l";
  return <Animated.View style={{ position: "absolute", width: 34, height: 34, [top ? "top" : "bottom"]: -6, [left ? "left" : "right"]: -6,
    borderColor: locked ? TEAL : "rgba(255,255,255,0.92)", [top ? "borderTopWidth" : "borderBottomWidth"]: 2.5, [left ? "borderLeftWidth" : "borderRightWidth"]: 2.5,
    [`border${top ? "Top" : "Bottom"}${left ? "Left" : "Right"}Radius`]: 14, transitionProperty: "borderColor", transitionDuration: 160 } as never} />;
}

/** A printed page, drawn as text lines: the stand-in for a photo on the simulator. */
export function PageLines({ small = false }: { small?: boolean }) {
  return <View style={{ flex: 1, padding: small ? 4 : 22, gap: small ? 3 : 12 }}>
    {[0.6, 0.9, 0.8, 0.95, 0.7, 0.85, 0.5, 0.9, 0.75].slice(0, small ? 6 : 9).map((f, i) => <View key={i} style={{ width: `${f * 100}%`, height: small ? 2 : 6, borderRadius: 3, backgroundColor: i === 0 ? "rgba(29,31,35,0.5)" : "rgba(29,31,35,0.18)" }} />)}
  </View>;
}

/** Development only: a desk with a synthetic page under the guide, since the simulator has no camera. */
export function DeskStandIn({ frame }: { frame: { left: number; top: number; width: number; height: number } }) {
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: "#4A4038" }]}>
    <View style={{ position: "absolute", left: frame.left + 8, top: frame.top + 10, width: frame.width - 16, height: frame.height - 20, borderRadius: 4, backgroundColor: "#F6F3EC", transform: [{ rotate: "-1.5deg" }], boxShadow: "0 12px 34px rgba(0,0,0,0.45)" }}>
      <PageLines />
    </View>
  </View>;
}
