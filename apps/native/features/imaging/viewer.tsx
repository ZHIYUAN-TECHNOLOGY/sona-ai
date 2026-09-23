import { Text } from "@/components/sona/text";
import { Image } from "expo-image";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cancelAnimation, FadeIn, FadeOut, type SharedValue, useAnimatedReaction, useAnimatedStyle, useSharedValue, withDecay, withSpring, type WithSpringConfig } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { LAYOUT_SPRING } from "@/components/sona/motion";
import { palette } from "@/components/sona/theme";
import { Action, Chip, Icon, pillStyle, SourceLink, useAccessibleEffects } from "@/components/sona/ui";
import type { TeachingImage } from "./fixture";
import { clamp, DOUBLE_TAP_ZOOM, fitted, limit, MAX_ZOOM, rubberBand, ZOOM_STEP, zoomAround } from "./zoom";

/** A finger let go: settle toward the limit carrying its velocity (a little give, no bounce past it). */
const SETTLE: WithSpringConfig = { duration: 400, dampingRatio: 0.8 };
/** Dark viewing surface, shared with the card preview and the empty state. */
export const VIEWING = { borderRadius: 24, borderCurve: "continuous", overflow: "hidden", backgroundColor: palette.ink } as const;
/** 1 pt low-opacity edge over images so the frame reads crisply on any content. */
export function ImageEdge() {
  return <View pointerEvents="none" style={{ position: "absolute", inset: 0, borderRadius: 24, borderCurve: "continuous", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" }} />;
}

/**
 * Original image with direct manipulation (after Apple Photos' pinch and Tilt's zoom readout).
 * Pinch zooms around the fingers, one finger pans once zoomed, double-tap zooms to the tapped
 * point or back to fit. Past a limit the image rubber-bands; on release it settles on a spring
 * carrying the gesture's velocity, and a flicked pan glides out with decay. Everything runs on
 * the UI thread; only zoom thresholds cross to React. Transforms move pixels, never alter them:
 * no filter, tint, blur or shader touches the image.
 */
export function OriginalImageViewer({ asset, onZoomChange }: { asset: TeachingImage; onZoomChange?: (zoomed: boolean) => void }) {
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
    return Gesture.Simultaneous(pinch, pan, doubleTap);
    // Shared values are stable; `bounds`/`moveTo` only close over them and `reducedMotion`.
  }, [ready, reducedMotion]);
  const transform = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: scale.get() }] }));

  // Only threshold crossings reach React: fit, zoomed, or at the zoom limit.
  const [level, setLevel] = useState(0);
  useAnimatedReaction(() => scale.get() >= MAX_ZOOM - 0.01 ? 2 : scale.get() > 1.05 ? 1 : 0, (next, prev) => { if (prev !== null && next !== prev) scheduleOnRN(setLevel, next); });
  const zoomed = level > 0;
  useEffect(() => { onZoomChange?.(zoomed); }, [zoomed, onZoomChange]);

  return <View style={{ gap: 14 }}>
    <View style={[VIEWING, { height: viewportHeight }]}>
      <GestureDetector gesture={gesture}>
        <View accessible accessibilityRole="adjustable" accessibilityLabel={`Original teaching image: ${asset.title}`} accessibilityValue={{ text: zoomed ? "Zoomed in" : "Fit to screen" }}
          accessibilityActions={[{ name: "increment", label: "Zoom in" }, { name: "decrement", label: "Zoom out" }]} onAccessibilityAction={e => step(e.nativeEvent.actionName === "increment" ? ZOOM_STEP : -ZOOM_STEP)}
          onLayout={e => { const { width: w, height: h } = e.nativeEvent.layout; viewport.set({ w, h }); scale.set(1); x.set(0); y.set(0); }} style={{ flex: 1 }}>
          <Animated.View style={[{ flex: 1 }, transform]}>
            <Image key={`${asset.id}-${attempt}`} source={asset.source} contentFit="contain" style={{ flex: 1 }} transition={reducedMotion ? 0 : 200}
              onLoadStart={() => setStatus("loading")} onLoad={e => { if (e.source.width && e.source.height) aspect.set(e.source.width / e.source.height); setStatus("ready"); }} onError={() => setStatus("failed")} />
          </Animated.View>
        </View>
      </GestureDetector>
      {status !== "ready" && <Animated.View exiting={FadeOut.duration(160)} style={{ position: "absolute", inset: 0, backgroundColor: palette.ink, justifyContent: "center", alignItems: "center", padding: 24, gap: 16 }}>
        {status === "loading"
          ? <><ActivityIndicator color={palette.line} /><Text style={{ color: palette.line, fontSize: 14 }}>Loading original image…</Text></>
          : <><Text selectable style={{ color: palette.line, fontSize: 15, lineHeight: 21, textAlign: "center" }}>This attachment could not be opened.</Text><Action label="Retry image" secondary onPress={() => { setStatus("loading"); setAttempt(value => value + 1); }} /></>}
      </Animated.View>}
      <ImageEdge />
    </View>

    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: palette.muted }}>{zoomed ? "Drag to inspect · double-tap to fit" : "Pinch or double-tap to zoom"}</Text>
      {zoomed && <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)}>
        <Chip label="Reset view" icon={<Icon name="arrow.counterclockwise" size={15} />} onPress={reset} />
      </Animated.View>}
      <View style={[pillStyle, { borderRadius: 22, flexDirection: "row", alignItems: "center" }]}>
        <StepButton icon="minus.magnifyingglass" label="Zoom out" disabled={!ready || !zoomed} onPress={() => step(-ZOOM_STEP)} />
        <ZoomReadout scale={scale} />
        <StepButton icon="plus.magnifyingglass" label="Zoom in" disabled={!ready || level === 2} onPress={() => step(ZOOM_STEP)} />
      </View>
    </View>

    <View style={{ gap: 2 }}>
      <Text selectable style={{ fontSize: 15, fontWeight: "600", color: palette.ink }}>{asset.title}</Text>
      <Text selectable style={{ fontSize: 13, lineHeight: 19, color: palette.muted }}>{asset.attribution} · {asset.license}</Text>
      {asset.sourceUrl.startsWith("https://")
        ? <SourceLink label="Original source & license" onPress={() => { void Linking.openURL(asset.sourceUrl).catch(() => setSourceError(true)); }} />
        : <Text selectable style={{ fontSize: 13, lineHeight: 19, color: palette.muted }}>{asset.sourceUrl}</Text>}
      {sourceError && <Text selectable style={{ fontSize: 13, lineHeight: 19, color: palette.amber }}>Source page unavailable. Try again when connected.</Text>}
    </View>
  </View>;
}

function StepButton({ icon, label, disabled, onPress }: { icon: string; label: string; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ width: 44, height: 44, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.35 : 1, transform: [{ scale: pressed ? 0.96 : 1 }], transitionProperty: ["transform", "opacity"], transitionDuration: 120 } as never)}>
    <Icon name={icon} size={18} />
  </Pressable>;
}

/** Live zoom (after Tilt's floating readout); crosses to React once per 0.1×, never per frame. */
function ZoomReadout({ scale }: { scale: SharedValue<number> }) {
  const [zoom, setZoom] = useState(1);
  useAnimatedReaction(() => Math.round(clamp(scale.get(), 1, MAX_ZOOM) * 10) / 10, (next, prev) => { if (prev !== null && next !== prev) scheduleOnRN(setZoom, next); });
  return <Text accessibilityElementsHidden importantForAccessibility="no" style={{ minWidth: 40, textAlign: "center", fontSize: 13, fontWeight: "600", color: palette.ink, fontVariant: ["tabular-nums"] }}>{zoom.toFixed(1)}×</Text>;
}
