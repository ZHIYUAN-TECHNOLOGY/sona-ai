import { useEffect, useMemo, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

import { WaveformCurve } from "@/components/consult/WaveformCurve";
import { useMicAmplitude } from "@/lib/audio/useMicAmplitude";
import { colors } from "@/lib/theme";

const BAR_COUNT = 32;

/**
 * Record-screen waveform. When the mic is driving real amplitude
 * (useMicAmplitude.active), renders the live SVG curve; otherwise falls back to the
 * decorative bar animation — so the visual is always alive, even in Expo Go / a
 * simulator with no mic, or when permission is denied. The demo never shows a dead box.
 */
export function Waveform({ live = true }: { live?: boolean }) {
  const { amplitudes, active } = useMicAmplitude(live);
  if (active) return <WaveformCurve amplitudes={amplitudes} />;
  return <DecorativeWave live={live} />;
}

/**
 * Transform-only animated bars (scaleY) on the RN Animated native driver — cheap,
 * no layout thrash. Purely decorative fallback when no real mic amplitude is available.
 */
function DecorativeWave({ live }: { live: boolean }) {
  const anims = useRef(Array.from({ length: BAR_COUNT }, () => new Animated.Value(0.3))).current;

  const timings = useMemo(
    () => anims.map((_, i) => ({ duration: 460 + (i % 5) * 120, delay: (i % 7) * 55 })),
    [anims],
  );

  useEffect(() => {
    if (!live) return;
    const loops = anims.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, {
            toValue: 0.95,
            duration: timings[i].duration,
            delay: timings[i].delay,
            useNativeDriver: true,
          }),
          Animated.timing(v, {
            toValue: 0.18,
            duration: timings[i].duration,
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [live, anims, timings]);

  return (
    <View style={styles.wave} accessible={false} pointerEvents="none">
      {anims.map((v, i) => (
        <Animated.View
          key={i}
          style={[
            styles.bar,
            { transform: [{ scaleY: live ? v : 0.5 }], opacity: i % 4 === 0 ? 0.75 : 1 },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wave: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2.5,
    height: 40,
  },
  bar: { width: 3, height: 34, borderRadius: 2, backgroundColor: colors.green },
});
