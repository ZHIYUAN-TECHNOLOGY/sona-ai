import { useCallback } from "react";
import { useFrameCallback, useReducedMotion, useSharedValue } from "react-native-reanimated";

import { WaveformCurve } from "@/components/consult/WaveformCurve";
import { useMicAmplitude, WAVE_POINTS } from "@/lib/audio/useMicAmplitude";

/**
 * Record-screen waveform. One smooth Reanimated renderer (WaveformCurve) fed by either
 * the real mic amplitude (when the audio module is live) or a synthetic flowing idle
 * wave — so the visual is always alive and fluid, never a stepped or dead line, and it
 * needs no native SVG. Both paths spring-ease, so switching between them stays smooth.
 */
export function Waveform({ live = true }: { live?: boolean }) {
  const { amplitudes, active } = useMicAmplitude(live);
  const idle = useSharedValue<number[]>(new Array(WAVE_POINTS).fill(0.12));
  const reduce = useReducedMotion();

  // 60fps synthetic wave when the mic isn't driving amplitude. Two layered sines give an
  // organic left-to-right flow. modify() mutates in place (no per-frame allocation) and
  // triggers the bars. Skipped when the mic is live or reduced-motion is on.
  const onFrame = useCallback(
    (f: { timeSinceFirstFrame: number }) => {
      "worklet";
      if (active || reduce) return;
      const t = f.timeSinceFirstFrame / 1000;
      idle.modify((arr) => {
        "worklet";
        for (let i = 0; i < arr.length; i++) {
          const a = Math.sin(t * 1.7 - i * 0.32) * 0.5 + 0.5;
          const b = Math.sin(t * 0.9 + i * 0.14) * 0.5 + 0.5;
          arr[i] = 0.08 + 0.24 * a * (0.55 + 0.45 * b);
        }
        return arr;
      });
    },
    [active, reduce, idle],
  );
  useFrameCallback(onFrame);

  return <WaveformCurve amplitudes={active ? amplitudes : idle} />;
}
