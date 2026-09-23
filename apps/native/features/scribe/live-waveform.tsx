import { Canvas, Fill, Shader, Skia, type SkSize } from "@shopify/react-native-skia";
import { useEffect } from "react";
import { useDerivedValue, useFrameCallback, useSharedValue, withTiming } from "react-native-reanimated";
import { EASE_OUT } from "@/components/sona/motion";
import { useVisible } from "@/components/sona/use-visible";

/**
 * Recorder trace drawn in one shader pass: capsule bars scroll in from the right (newest, full
 * blue) and thin out to the left (older, lighter). A slow envelope gates per-bar height so the
 * trace groups into words and pauses. At rest it settles into a quiet dotted line.
 */
const effect = Skia.RuntimeEffect.Make(`
uniform float2 res;
uniform float t;
uniform float level;
uniform float dim;

float hash(float n) { return fract(sin(mod(n, 1024.0) * 12.9898) * 43758.5453); }
float noise(float x) { float i = floor(x); float f = fract(x); return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f)); }

half4 main(float2 p) {
  float pitch = 6.0;
  float halfW = 1.25;
  float g = p.x / pitch + t;
  float id = floor(g);
  float lx = (fract(g) - 0.5) * pitch;
  float words = smoothstep(0.28, 0.72, noise(id * 0.16));
  float amp = 0.1 + 0.9 * words * (0.45 + 0.55 * hash(id));
  float u = p.x / res.x;
  float edge = smoothstep(0.0, 0.22, u) * smoothstep(1.0, 0.94, u);
  float halfH = max(halfW, res.y * 0.5 * amp * level * edge);
  float dy = max(abs(p.y - res.y * 0.5) - (halfH - halfW), 0.0);
  float a = clamp(0.5 - (length(float2(lx, dy)) - halfW), 0.0, 1.0);
  if (a <= 0.0) { return half4(0.0); }
  half3 col = mix(half3(0.141, 0.357, 0.8), half3(0.6, 0.64, 0.69), dim * 0.85);
  float alpha = a * mix(0.28, 1.0, smoothstep(0.0, 0.85, u)) * mix(1.0, 0.7, dim);
  return half4(col * alpha, alpha);
}`)!;

/** Bars scrolled per second while live: about 36 pt/s, calm enough to read beside the transcript. */
const BARS_PER_SECOND = 6;

/** `live` scrolls; `held` (paused or finished) freezes the trace and greys it; `idle` is a dotted line. */
export function LiveWaveform({ state, reducedMotion, height = 64 }: { state: "idle" | "live" | "held"; reducedMotion: boolean; height?: number }) {
  const size = useSharedValue<SkSize>({ width: 0, height: 0 });
  const t = useSharedValue(0);
  const level = useSharedValue(state === "idle" ? 0 : 1);
  const dim = useSharedValue(state === "live" ? 0 : 1);
  useEffect(() => {
    level.set(withTiming(state === "idle" ? 0 : 1, { duration: reducedMotion ? 0 : 520, easing: EASE_OUT }));
    dim.set(withTiming(state === "live" ? 0 : 1, { duration: reducedMotion ? 0 : 300, easing: EASE_OUT }));
  }, [state, reducedMotion, level, dim]);
  // Time integrates on the UI thread; React never re-renders per frame.
  const clock = useFrameCallback(frame => {
    const dt = Math.min(frame.timeSincePreviousFrame ?? 16, 64) / 1000;
    t.set(t.get() + dt * BARS_PER_SECOND);
  }, false);
  const visible = useVisible();
  // Still under Reduce Motion, and no redraws while covered or backgrounded.
  useEffect(() => { clock.setActive(state === "live" && visible && !reducedMotion); return () => clock.setActive(false); }, [state, visible, reducedMotion, clock]);
  const uniforms = useDerivedValue(() => ({ res: [size.value.width, size.value.height], t: t.value, level: level.value, dim: dim.value }));
  return <Canvas pointerEvents="none" onSize={size} style={{ height, alignSelf: "stretch" }}>
    <Fill><Shader source={effect} uniforms={uniforms} /></Fill>
  </Canvas>;
}
