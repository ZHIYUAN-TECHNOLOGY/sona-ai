import { PressScale } from "@/components/sona/parts";
import { Canvas, Fill, Shader, Skia } from "@shopify/react-native-skia";
import { Text } from "@/components/sona/text";
import { Image } from "expo-image";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cancelAnimation, FadeIn, FadeOut, type SharedValue, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withDecay, withSpring, withTiming, type WithSpringConfig } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { EASE_IN_OUT, EASE_OUT, LAYOUT_SPRING } from "@/components/sona/motion";
import { palette, type, radius } from "@/components/sona/theme";
import { Action, Chip, Icon, pillStyle, SourceLink, useAccessibleEffects } from "@/components/sona/ui";
import type { TeachingImage } from "./fixture";
import { FilmScan } from "./scan";
import type { ScanState } from "./upload";
import { clamp, DOUBLE_TAP_ZOOM, fitted, limit, markerAt, markerUnder, MAX_ZOOM, rubberBand, ZOOM_STEP, zoomAround } from "./zoom";

/** A finger let go: settle toward the limit carrying its velocity (a little give, no bounce past it). */
const SETTLE: WithSpringConfig = { duration: 400, dampingRatio: 0.8 };
/** Dark viewing surface, shared with the card preview and the empty state. */
export const VIEWING = { borderRadius: radius.card, borderCurve: "continuous", overflow: "hidden", backgroundColor: palette.ink } as const;
/** 1 pt low-opacity edge over images so the frame reads crisply on any content. */
export function ImageEdge() {
  return <View pointerEvents="none" style={{ position: "absolute", inset: 0, borderRadius: radius.card, borderCurve: "continuous", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" }} />;
}

/**
 * Original image with direct manipulation (after Apple Photos' pinch and Tilt's zoom readout).
 * Pinch zooms around the fingers, one finger pans once zoomed, double-tap zooms to the tapped
 * point or back to fit. Past a limit the image rubber-bands; on release it settles on a spring
 * carrying the gesture's velocity, and a flicked pan glides out with decay. Everything runs on
 * the UI thread; only zoom thresholds cross to React. Transforms move pixels, never alter them:
 * no filter, tint, blur or shader touches the image. The finding torch is a separate layer above
 * it, only while a finding is in focus, and tapping anywhere else takes it away; so is the
 * reading scan (`FilmScan`), only while the image model reads the film.
 */
export function OriginalImageViewer({ asset, onZoomChange, markers = [], focus, onFocus, scan = "off" }: { asset: TeachingImage; onZoomChange?: (zoomed: boolean) => void; markers?: ImageMarker[]; focus?: string; onFocus?: (id: string | undefined) => void; scan?: ScanState }) {
  const { height, width } = useWindowDimensions();
  const viewportHeight = Math.max(260, Math.min(560, height * 0.52, width * 1.3));
  const { reducedMotion } = useAccessibleEffects();
  const [sourceError, setSourceError] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const ready = status === "ready";
  const scale = useSharedValue(1), x = useSharedValue(0), y = useSharedValue(0);
  const start = useSharedValue({ scale: 1, x: 0, y: 0, fx: 0, fy: 0 });
  const focal = useSharedValue({ x: 0, y: 0 });
  const viewport = useSharedValue({ w: 1, h: 1 });
  const aspect = useSharedValue(0);

  const bounds = (s: number): [number, number] => {
    "worklet";
    const { w, h } = viewport.get();
    const [cw, ch] = fitted(w, h, aspect.get());
    return [limit(cw, w, s), limit(ch, h, s)];
  };
  const moveTo = (s: number, tx: number, ty: number, spring: WithSpringConfig, velocity = 0) => {
    "worklet";
    if (reducedMotion) { scale.set(s); x.set(tx); y.set(ty); return; }
    scale.set(withSpring(s, { ...spring, velocity }));
    x.set(withSpring(tx, spring));
    y.set(withSpring(ty, spring));
  };
  /** Zoom to `to`, keeping the point at (px, py) from centre where it is, then stay inside the edges. */
  const zoomTo = (to: number, px: number, py: number, spring: WithSpringConfig, velocity = 0) => {
    "worklet";
    const from = scale.get();
    const [bx, by] = bounds(to);
    moveTo(to, clamp(zoomAround(px, x.get(), from, to), -bx, bx), clamp(zoomAround(py, y.get(), from, to), -by, by), spring, velocity);
  };
  const reset = () => moveTo(1, 0, 0, LAYOUT_SPRING);
  const step = (delta: number) => { if (ready) zoomTo(clamp(scale.get() + delta, 1, MAX_ZOOM), 0, 0, LAYOUT_SPRING); };

  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch().enabled(ready)
      .onStart(e => {
        cancelAnimation(scale); cancelAnimation(x); cancelAnimation(y);
        const { w, h } = viewport.get(), fx = e.focalX - w / 2, fy = e.focalY - h / 2;
        start.set({ scale: scale.get(), x: x.get(), y: y.get(), fx, fy });
        focal.set({ x: fx, y: fy });
      })
      .onUpdate(e => {
        const { w, h } = viewport.get(), s0 = start.get();
        const s = rubberBand(s0.scale * e.scale, 1, MAX_ZOOM, 1);
        const fx = e.focalX - w / 2, fy = e.focalY - h / 2;
        const [bx, by] = bounds(s);
        focal.set({ x: fx, y: fy });
        scale.set(s);
        // The point first pinched stays under the fingers, and follows them as they move.
        x.set(rubberBand(fx - ((s0.fx - s0.x) * s) / s0.scale, -bx, bx, w));
        y.set(rubberBand(fy - ((s0.fy - s0.y) * s) / s0.scale, -by, by, h));
      })
      .onEnd(e => {
        const f = focal.get();
        zoomTo(clamp(scale.get(), 1, MAX_ZOOM), f.x, f.y, SETTLE, e.velocity);
      });
    const pan = Gesture.Pan().enabled(ready).maxPointers(1)
      // At fit-to-screen size a swipe scrolls the page instead of a stationary image.
      .onTouchesDown((_e, manager) => { if (scale.get() <= 1.01) manager.fail(); })
      .onStart(() => {
        cancelAnimation(x); cancelAnimation(y);
        start.set({ ...start.get(), x: x.get(), y: y.get() });
      })
      .onUpdate(e => {
        const { w, h } = viewport.get(), s0 = start.get();
        const [bx, by] = bounds(scale.get());
        x.set(rubberBand(s0.x + e.translationX, -bx, bx, w));
        y.set(rubberBand(s0.y + e.translationY, -by, by, h));
      })
      .onEnd(e => {
        const [bx, by] = bounds(scale.get());
        if (reducedMotion) { x.set(clamp(x.get(), -bx, bx)); y.set(clamp(y.get(), -by, by)); return; }
        x.set(withDecay({ velocity: e.velocityX, clamp: [-bx, bx], rubberBandEffect: true }));
        y.set(withDecay({ velocity: e.velocityY, clamp: [-by, by], rubberBandEffect: true }));
      });
    const doubleTap = Gesture.Tap().enabled(ready).numberOfTaps(2)
      .onEnd((e, success) => {
        if (!success) return;
        const { w, h } = viewport.get();
        if (scale.get() > 1.01) moveTo(1, 0, 0, LAYOUT_SPRING);
        else zoomTo(DOUBLE_TAP_ZOOM, e.x - w / 2, e.y - h / 2, LAYOUT_SPRING);
      });
    // One tap (once a double-tap is ruled out) focuses the nearest marker, or clears the focus.
    const points = markers.map(m => ({ id: m.id, x: m.x, y: m.y }));
    const tap = Gesture.Tap().enabled(ready && Boolean(onFocus)).onEnd((e, success) => {
      if (!success || !onFocus) return;
      const { w, h } = viewport.get();
      scheduleOnRN(onFocus, markerUnder(points, e.x, e.y, { w, h, aspect: aspect.get(), scale: scale.get(), x: x.get(), y: y.get() }, RING * 1.2));
    });
    return Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, tap));
    // Shared values are stable; `bounds`/`moveTo` only close over them and `reducedMotion`.
  }, [ready, reducedMotion, markers, onFocus]); // eslint-disable-line react-hooks/exhaustive-deps
  const transform = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: scale.get() }] }));

  // Only threshold crossings reach React: fit, zoomed, or at the zoom limit.
  const [level, setLevel] = useState(0);
  useAnimatedReaction(() => scale.get() >= MAX_ZOOM - 0.01 ? 2 : scale.get() > 1.05 ? 1 : 0, (next, prev) => { if (prev !== null && next !== prev) scheduleOnRN(setLevel, next); });
  const zoomed = level > 0;
  useEffect(() => { onZoomChange?.(zoomed); }, [zoomed, onZoomChange]);

  return <View style={{ gap: 14 }}>
    <View style={[VIEWING, { height: viewportHeight }]}>
      <GestureDetector gesture={gesture}>
        <View accessible accessibilityRole="adjustable" accessibilityLabel={`Original teaching image: ${asset.title}${markers.length ? `, ${markers.length} unvalidated finding markers` : ""}`} accessibilityValue={{ text: zoomed ? "Zoomed in" : "Fit to screen" }}
          accessibilityActions={[{ name: "increment", label: "Zoom in" }, { name: "decrement", label: "Zoom out" }]} onAccessibilityAction={e => step(e.nativeEvent.actionName === "increment" ? ZOOM_STEP : -ZOOM_STEP)}
          onLayout={e => { const { width: w, height: h } = e.nativeEvent.layout; viewport.set({ w, h }); scale.set(1); x.set(0); y.set(0); }} style={{ flex: 1 }}>
          <Animated.View style={[{ flex: 1 }, transform]}>
            <Image key={`${asset.id}-${attempt}`} source={asset.source} contentFit="contain" style={{ flex: 1 }} transition={reducedMotion ? 0 : 200}
              onLoadStart={() => setStatus("loading")} onLoad={e => { if (e.source.width && e.source.height) aspect.set(e.source.width / e.source.height); setStatus("ready"); }} onError={() => setStatus("failed")} />
            {ready && <Torch box={regionOf(markers.find(m => m.id === focus))} viewport={viewport} aspect={aspect} reducedMotion={reducedMotion} />}
            {ready && markers.map(m => <Marker key={m.id} marker={m} viewport={viewport} aspect={aspect} scale={scale} state={!focus ? "idle" : focus === m.id ? "focused" : "dimmed"} />)}
          </Animated.View>
        </View>
      </GestureDetector>
      {/* While the image model reads this film: the scan rides its pan and zoom; the frame and status line stay put. */}
      {ready && <FilmScan source={asset.source} state={scan} filmStyle={transform} />}
      {status !== "ready" && <Animated.View exiting={FadeOut.duration(160)} style={{ position: "absolute", inset: 0, backgroundColor: palette.ink, justifyContent: "center", alignItems: "center", padding: 24, gap: 16 }}>
        {status === "loading"
          ? <><ActivityIndicator color={palette.line} /><Text style={{ color: palette.line, ...type.subhead }}>Loading original image…</Text></>
          : <><Text selectable style={{ ...type.callout, color: palette.line, textAlign: "center" }}>This attachment could not be opened.</Text><Action label="Retry image" secondary onPress={() => { setStatus("loading"); setAttempt(value => value + 1); }} /></>}
      </Animated.View>}
      {ready && focus && <FocusCaption key={focus} markers={markers} focus={focus} onFocus={onFocus} reducedMotion={reducedMotion} />}
      {ready && markers.length > 0 && <View pointerEvents="none" style={{ position: "absolute", top: 12, left: 12, height: 24, paddingHorizontal: 10, borderRadius: 12, justifyContent: "center", backgroundColor: "rgba(20,28,40,0.6)", borderWidth: 1, borderColor: "rgba(255,255,255,0.16)" }}>
        <Text style={{ ...type.caption, fontWeight: "700", letterSpacing: 0.4, color: palette.white }}>Unvalidated</Text>
      </View>}
      <ImageEdge />
    </View>

    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
      {zoomed && <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)}>
        <Chip label="Reset view" icon={<Icon name="arrow.counterclockwise" size={15} />} onPress={reset} />
      </Animated.View>}
      <View style={[pillStyle, { borderRadius: 22, flexDirection: "row", alignItems: "center" }]}>
        <StepButton icon="minus.magnifyingglass" label="Zoom out" disabled={!ready || !zoomed} onPress={() => step(-ZOOM_STEP)} />
        <ZoomReadout scale={scale} />
        <StepButton icon="plus.magnifyingglass" label="Zoom in" disabled={!ready || level === 2} onPress={() => step(ZOOM_STEP)} />
      </View>
    </View>

    {/* Provenance as one line: attribution · licence, with the original source when there is one. */}
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Text selectable style={{ ...type.footnote, flex: 1, color: palette.muted }}>{asset.attribution} · {asset.license}{sourceError && <Text style={{ color: palette.amber }}> · Source unavailable offline</Text>}</Text>
      {asset.sourceUrl.startsWith("https://") && <SourceLink label="Source" onPress={() => { void Linking.openURL(asset.sourceUrl).catch(() => setSourceError(true)); }} />}
    </View>
  </View>;
}

/** A numbered ring at a normalised point on the image (demo flow 6's finding markers), with the model's box when there is one. */
export type ImageMarker = { id: string; n: number; x: number; y: number; label: string; box?: [number, number, number, number] };
const RING = 24;
/** Rides the image's pan and zoom, counter-scaled so the ring stays one size while the pixels under it grow. */
function Marker({ marker, viewport, aspect, scale, state }: { marker: ImageMarker; viewport: SharedValue<{ w: number; h: number }>; aspect: SharedValue<number>; scale: SharedValue<number>; state: "idle" | "focused" | "dimmed" }) {
  const place = useAnimatedStyle(() => {
    const { w, h } = viewport.get();
    const [px, py] = markerAt(w, h, aspect.get(), marker.x, marker.y);
    return { left: px - RING / 2, top: py - RING / 2, transform: [{ scale: 1 / scale.get() }] };
  });
  // The focused ring turns white inside the light; the others step back without leaving.
  return <Animated.View pointerEvents="none" style={[{ position: "absolute", width: RING, height: RING, borderRadius: RING / 2, borderWidth: 2, alignItems: "center", justifyContent: "center",
    borderColor: state === "focused" ? palette.white : "#9CC0FF", backgroundColor: state === "focused" ? "rgba(36,91,204,0.75)" : "rgba(36,91,204,0.3)", opacity: state === "dimmed" ? 0.4 : 1,
    transitionProperty: ["opacity", "borderColor", "backgroundColor"], transitionDuration: 200 } as never, place]}>
    <Text style={{ ...type.caption, fontWeight: "700", color: palette.white, fontVariant: ["tabular-nums"] }}>{marker.n}</Text>
  </Animated.View>;
}

function StepButton({ icon, label, disabled, onPress }: { icon: string; label: string; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}>{({ pressed }) => <PressScale pressed={pressed} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.35 : 1, transitionProperty: ["transform", "opacity"] }}>
    <Icon name={icon} size={18} />
  </PressScale>}</Pressable>;
}

/** Live zoom (after Tilt's floating readout); crosses to React once per 0.1×, never per frame. */
function ZoomReadout({ scale }: { scale: SharedValue<number> }) {
  const [zoom, setZoom] = useState(1);
  useAnimatedReaction(() => Math.round(clamp(scale.get(), 1, MAX_ZOOM) * 10) / 10, (next, prev) => { if (prev !== null && next !== prev) scheduleOnRN(setZoom, next); });
  return <Text accessibilityElementsHidden importantForAccessibility="no" style={{ minWidth: 40, textAlign: "center", ...type.footnote, fontWeight: "600", color: palette.ink, fontVariant: ["tabular-nums"] }}>{zoom.toFixed(1)}×</Text>;
}

/**
 * The torch (after IntoWallet's spotlight walkthrough): the film dims around a feathered light
 * over the focused finding's box, and the light travels and resizes to the next one. A layer over
 * the image, never a change to it. Halftone dots mark only the edge of the light, as an accent.
 */
const torch = Skia.RuntimeEffect.Make(`
uniform float2 c;
uniform float2 r;
uniform float dim;
half4 main(float2 q) {
  float d = length((q - c) / r);
  float shade = smoothstep(0.62, 1.0, d) * dim;
  float rim = exp(-pow((d - 0.86) / 0.07, 2.0));
  float dotShape = 1.0 - smoothstep(0.18, 0.3, length(fract(q / 4.0) - 0.5));
  float alpha = max(shade, dotShape * rim * dim * 0.22);
  half3 ink = mix(half3(0.04, 0.06, 0.1), half3(0.61, 0.75, 1.0), dotShape * rim);
  return half4(ink * alpha, alpha);
}`)!;
/** The model's box, or a small region around the point when a finding came without one. */
const regionOf = (m?: ImageMarker): [number, number, number, number] | undefined => m && (m.box ?? [m.y - 0.05, m.x - 0.06, m.y + 0.05, m.x + 0.06]);
/** Film dimmed to this under the torch: the finding stands out, the rest stays readable. */
const DIM = 0.62;
const TRAVEL = { duration: 450, easing: EASE_IN_OUT };

function Torch({ box, viewport, aspect, reducedMotion }: { box?: [number, number, number, number]; viewport: SharedValue<{ w: number; h: number }>; aspect: SharedValue<number>; reducedMotion: boolean }) {
  const cx = useSharedValue(0), cy = useSharedValue(0), rx = useSharedValue(1), ry = useSharedValue(1), dim = useSharedValue(0);
  const target = useSharedValue<[number, number, number, number] | null>(null);
  useEffect(() => { target.set(box ?? null); }, [box?.join(","), target]); // eslint-disable-line react-hooks/exhaustive-deps
  useAnimatedReaction(() => ({ b: target.get(), v: viewport.get(), a: aspect.get() }), ({ b, v, a }) => {
    if (!b) { dim.set(reducedMotion ? 0 : withTiming(0, { duration: 240, easing: EASE_OUT })); return; }
    const [x0, y0] = markerAt(v.w, v.h, a, b[1], b[0]), [x1, y1] = markerAt(v.w, v.h, a, b[3], b[2]);
    // The light reaches a little past the box, never smaller than a fingertip, never wider than it is tall by much.
    const w = Math.max(44, (x1 - x0) * 0.85), h = Math.max(44, Math.min(w * 1.6, (y1 - y0) * 0.85));
    const next = [(x0 + x1) / 2, (y0 + y1) / 2, w, h];
    // From dark, the light blooms where it lands; once lit, it travels.
    const travel = !reducedMotion && dim.get() > 0.05;
    [cx, cy, rx, ry].forEach((value, i) => value.set(travel ? withTiming(next[i]!, TRAVEL) : next[i]!));
    dim.set(reducedMotion ? DIM : withTiming(DIM, { duration: 300, easing: EASE_OUT }));
  }, [reducedMotion]);
  const uniforms = useDerivedValue(() => ({ c: [cx.get(), cy.get()], r: [rx.get(), ry.get()], dim: dim.get() }));
  return <Canvas pointerEvents="none" style={{ position: "absolute", inset: 0 }}>
    <Fill><Shader source={torch} uniforms={uniforms} /></Fill>
  </Canvas>;
}

/** One line over the film for the focused finding; it crossfades per finding and steps to the next (after the last, back to the whole film). */
function FocusCaption({ markers, focus, onFocus, reducedMotion }: { markers: ImageMarker[]; focus: string; onFocus?: (id: string | undefined) => void; reducedMotion: boolean }) {
  const i = markers.findIndex(m => m.id === focus), marker = markers[i];
  if (!marker) return null;
  const next = markers[i + 1];
  return <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(200).easing(EASE_OUT)} exiting={reducedMotion ? undefined : FadeOut.duration(150)}
    style={{ position: "absolute", left: 12, right: 12, bottom: 12, minHeight: 44, borderRadius: 22, paddingLeft: 14, paddingRight: 4, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(20,28,40,0.62)", borderWidth: 1, borderColor: "rgba(255,255,255,0.16)" }}>
    <Text numberOfLines={1} style={{ flex: 1, ...type.subhead, fontWeight: "600", color: palette.white }}>
      <Text style={{ color: "#9CC0FF", fontVariant: ["tabular-nums"] }}>{marker.n} of {markers.length}  </Text>{marker.label}
    </Text>
    <Pressable accessibilityRole="button" accessibilityLabel={next ? `Next finding: ${next.label}` : "Show the whole film"} hitSlop={4} onPress={() => onFocus?.(next?.id)}>{({ pressed }) => <PressScale pressed={pressed} style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.14)" }}>
      <Icon name={next ? "chevron.right" : "xmark"} size={14} color={palette.white} />
    </PressScale>}</Pressable>
  </Animated.View>;
}
