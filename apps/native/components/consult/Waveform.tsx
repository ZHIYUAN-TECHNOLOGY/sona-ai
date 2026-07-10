import { useCallback } from "react";
import { useFrameCallback, useReducedMotion, useSharedValue } from "react-native-reanimated";

import { WaveformCurve } from "@/components/consult/WaveformCurve";
import { useMicAmplitude, WAVE_POINTS } from "@/lib/audio/useMicAmplitude";

// Temporal smoothing rate: fraction of the gap closed per frame (60fps). Low = slow,
// calm, elegant follow — high felt jittery/too fast. ~0.09 ≈ 170ms settle.
const FOLLOW = 0.09;

/**
 * Record-screen waveform. Produces ONE temporally-smoothed `display` signal — each frame
 * it eases (lerps) toward either the live mic amplitude or a slow synthetic idle wave —
 * and hands it to WaveformCurve (Skia curve, or bars fallback). The slow lerp is what
 * makes the motion feel calm and fluid instead of snapping to every amplitude spike.
 */
export function Waveform({ live = true }: { live?: boolean }) {
  const { amplitudes, active } = useMicAmplitude(live);
  const idle = useSharedValue<number[]>(new Array(WAVE_POINTS).fill(0.08));
  const display = useSharedValue<number[]>(new Array(WAVE_POINTS).fill(0.06));
  const reduce = useReducedMotion();

  const onFrame = useCallback(
    (f: { timeSinceFirstFrame: number }) => {
      "worklet";
      const t = f.timeSinceFirstFrame / 1000;
      // Slow synthetic breath when the mic isn't driving amplitude.
      if (!active && !reduce) {
        idle.modify((arr) => {
          "worklet";
          for (let i = 0; i < arr.length; i++) {
            const a = Math.sin(t * 0.9 - i * 0.22) * 0.5 + 0.5;
            const b = Math.sin(t * 0.45 + i * 0.09) * 0.5 + 0.5;
            arr[i] = 0.05 + 0.14 * a * (0.6 + 0.4 * b);
          }
          return arr;
        });
      }
      const target = active ? amplitudes.value : reduce ? display.value : idle.value;
      // Ease display toward the target — the calm, smooth follow.
      display.modify((d) => {
        "worklet";
        for (let i = 0; i < d.length; i++) d[i] += ((target[i] ?? 0) - d[i]) * FOLLOW;
        return d;
      });
    },
    [active, reduce, amplitudes, idle, display],
  );
  useFrameCallback(onFrame);

  return <WaveformCurve amplitudes={display} />;
}
