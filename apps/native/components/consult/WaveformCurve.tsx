import type { ComponentType } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  clamp,
  useAnimatedStyle,
  useDerivedValue,
  type SharedValue,
} from "react-native-reanimated";

import { WAVE_POINTS } from "@/lib/audio/useMicAmplitude";
import { colors } from "@/lib/theme";

// Prefer the premium Skia curve. If its native module (RNSkiaModule) isn't registered in
// the binary, the require throws at import — caught here so we fall back to bars and
// never crash. On a build where Skia links, the continuous curve is used.
let SkiaWaveform: ComponentType<{ amplitudes: SharedValue<number[]> }> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  SkiaWaveform = require("./SkiaWaveform").SkiaWaveform;
} catch {
  SkiaWaveform = null;
}

const HEIGHT = 44;

// Centre-weighted envelope: bars taper toward the edges so the wave focuses in the
// middle and dissolves at the sides.
function envelopeAt(i: number): number {
  const x = (i / (WAVE_POINTS - 1)) * 2 - 1;
  return 0.28 + 0.72 * Math.cos((x * Math.PI) / 2) ** 1.5;
}
const ENVELOPE = Array.from({ length: WAVE_POINTS }, (_, i) => envelopeAt(i));

/**
 * Waveform renderer. `amplitudes` is already temporally smoothed by the parent (a slow
 * per-frame lerp), so this just maps it to a shape — the Skia curve when available, else
 * centre-mirrored, edge-tapered, spatially-smoothed bars. No spring here (would fight the
 * parent's smoothing); transform-only, UI-thread.
 */
export function WaveformCurve({ amplitudes }: { amplitudes: SharedValue<number[]> }) {
  if (SkiaWaveform) return <SkiaWaveform amplitudes={amplitudes} />;
  return (
    <View style={styles.wave} accessible={false} pointerEvents="none">
      {Array.from({ length: WAVE_POINTS }).map((_, i) => (
        <Bar key={i} amplitudes={amplitudes} index={i} env={ENVELOPE[i]} />
      ))}
    </View>
  );
}

function Bar({
  amplitudes,
  index,
  env,
}: {
  amplitudes: SharedValue<number[]>;
  index: number;
  env: number;
}) {
  const h = useDerivedValue(() => {
    const a = amplitudes.value;
    const c = a[index] ?? 0;
    const l = a[index - 1] ?? c;
    const r = a[index + 1] ?? c;
    // 1-2-1 neighbour blur → smooth envelope across the bars (reads curve-like).
    return clamp(((l + 2 * c + r) / 4) * env, 0, 1);
  });
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: 0.035 + h.value * 0.965 }] }));
  return <Animated.View style={[styles.bar, style]} />;
}

const styles = StyleSheet.create({
  wave: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    height: HEIGHT,
    width: "100%",
  },
  bar: {
    flex: 1,
    maxWidth: 3.5,
    height: HEIGHT,
    borderRadius: 2,
    backgroundColor: colors.green,
    experimental_backgroundImage: `linear-gradient(to top, ${colors.greenDeep}, ${colors.green})`,
  },
});
