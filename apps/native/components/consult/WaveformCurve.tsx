import { StyleSheet, View } from "react-native";
import Animated, {
  clamp,
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";

import { WAVE_POINTS } from "@/lib/audio/useMicAmplitude";
import { colors } from "@/lib/theme";

const HEIGHT = 44;
// Overdamped spring — smooth follow of the live target, no wobble/overshoot, keeps
// velocity between the ~31 Hz pushes so the motion reads continuous, not stepped.
const SPRING = { mass: 0.5, stiffness: 150, damping: 20 } as const;

// Centre-weighted envelope: bars taper toward the edges (cosine falloff) so the wave
// focuses in the middle and dissolves at the sides — the elegant, not-a-block look.
function envelopeAt(i: number): number {
  const x = (i / (WAVE_POINTS - 1)) * 2 - 1; // -1..1
  return 0.28 + 0.72 * Math.cos((x * Math.PI) / 2) ** 1.5;
}
const ENVELOPE = Array.from({ length: WAVE_POINTS }, (_, i) => envelopeAt(i));

/**
 * Premium mic waveform: centre-mirrored, edge-tapered bars with a vertical gradient and
 * pill caps. Each bar springs toward a SPATIALLY-SMOOTHED target (averaged with its
 * neighbours) so the discrete amplitudes read as one flowing curve. Transform-only
 * (scaleY on the UI thread), no per-frame React re-render, no native SVG.
 */
export function WaveformCurve({ amplitudes }: { amplitudes: SharedValue<number[]> }) {
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
  const eased = useDerivedValue(() => {
    const a = amplitudes.value;
    const c = a[index] ?? 0;
    const l = a[index - 1] ?? c;
    const r = a[index + 1] ?? c;
    // 1-2-1 neighbour blur → a smooth envelope across the bars (curve, not spikes).
    const smoothed = (l + 2 * c + r) / 4;
    return withSpring(clamp(smoothed * env, 0, 1), SPRING);
  });
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: 0.035 + eased.value * 0.965 }] }));
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
    // Solid base (always visible) + a soft vertical gradient on top for depth. The
    // gradient is New-Arch only; if unsupported the solid green still shows.
    backgroundColor: colors.green,
    experimental_backgroundImage: `linear-gradient(to top, ${colors.greenDeep}, ${colors.green})`,
  },
});
