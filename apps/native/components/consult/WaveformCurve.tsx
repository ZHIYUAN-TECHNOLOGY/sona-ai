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

const HEIGHT = 40;
// Overdamped spring (dampingRatio ≈ 1.1) — smooth follow of the live amplitude with no
// wobble/overshoot, and it keeps velocity when the target changes (feels alive, not
// stepped). This is what smooths the ~31 Hz amplitude pushes into a fluid wave.
const SPRING = { mass: 0.5, stiffness: 150, damping: 19 } as const;

/**
 * Real-time mic waveform as centre-mirrored amplitude bars. Each bar's height springs
 * toward its live target on the UI thread (useDerivedValue → withSpring), driven by the
 * rolling amplitude ring the mic hook (or the synthetic idle) updates. Transform-only
 * (scaleY), no per-frame React re-render, no native SVG.
 */
export function WaveformCurve({ amplitudes }: { amplitudes: SharedValue<number[]> }) {
  return (
    <View style={styles.wave} accessible={false} pointerEvents="none">
      {Array.from({ length: WAVE_POINTS }).map((_, i) => (
        <Bar key={i} amplitudes={amplitudes} index={i} />
      ))}
    </View>
  );
}

function Bar({ amplitudes, index }: { amplitudes: SharedValue<number[]>; index: number }) {
  const eased = useDerivedValue(() =>
    withSpring(clamp(amplitudes.value[index] ?? 0, 0, 1), SPRING),
  );
  // 0.05 floor keeps a faint resting line; scaleY anchors at centre → mirrored bar.
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: 0.05 + eased.value * 0.95 }] }));
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
    maxWidth: 4,
    height: HEIGHT,
    borderRadius: 2,
    backgroundColor: colors.green,
  },
});
