import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";

import { WAVE_POINTS } from "@/lib/audio/useMicAmplitude";
import { colors } from "@/lib/theme";

const HEIGHT = 40;

/**
 * Real-time mic waveform as amplitude bars. Each bar's height is driven on the UI
 * thread (useAnimatedStyle) from the rolling amplitude ring the mic hook updates —
 * no React re-render per frame, and NO native SVG dependency (plain RN Views +
 * Reanimated), so it renders anywhere react-native-reanimated does.
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
  // Scale a full-height bar from the amplitude (0..1); a small floor keeps a faint
  // resting line. scaleY anchors at the centre → a mirrored, waveform-like bar.
  const style = useAnimatedStyle(() => {
    const a = amplitudes.value[index] ?? 0;
    return { transform: [{ scaleY: 0.06 + (a < 0 ? 0 : a > 1 ? 1 : a) * 0.94 }] };
  });
  return <Animated.View style={[styles.bar, style]} />;
}

const styles = StyleSheet.create({
  wave: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2.5,
    height: HEIGHT,
    width: "100%",
  },
  bar: {
    flex: 1,
    maxWidth: 4,
    height: HEIGHT - 6,
    borderRadius: 2,
    backgroundColor: colors.green,
  },
});
