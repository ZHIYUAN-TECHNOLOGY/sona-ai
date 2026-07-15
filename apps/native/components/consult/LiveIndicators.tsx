import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { colors, radius } from "@/lib/theme";

/** Blinking red record dot. Reduced motion: solid dot (state still legible by colour). */
export function RecDot({ live = true }: { live?: boolean }) {
  const reduce = useReducedMotion();
  const animate = live && !reduce;
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!animate) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.2, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [animate, opacity]);
  return <Animated.View style={[styles.dot, { opacity: animate ? opacity : 1 }]} />;
}

/** 4-bar mic level meter, animated. Reduced motion: static mid-height bars. */
export function MicMeter({ live = true }: { live?: boolean }) {
  const reduce = useReducedMotion();
  const animate = live && !reduce;
  const bars = useRef([6, 11, 13, 8].map((h) => ({ h, v: new Animated.Value(0.5) }))).current;
  useEffect(() => {
    if (!animate) return;
    const loops = bars.map(({ v }, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, {
            toValue: 1,
            duration: 420,
            delay: i * 90,
            useNativeDriver: true,
          }),
          Animated.timing(v, { toValue: 0.4, duration: 420, useNativeDriver: true }),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [animate, bars]);
  return (
    <View style={styles.meter}>
      {bars.map(({ h, v }, i) => (
        <Animated.View
          key={i}
          style={{
            width: 2.5,
            height: h,
            borderRadius: 1,
            backgroundColor: colors.green,
            transform: [{ scaleY: animate ? v : 0.6 }],
          }}
        />
      ))}
    </View>
  );
}

/** The "iPhone mic" device chip with the embedded meter. */
export function DeviceMicChip({ live = true }: { live?: boolean }) {
  return (
    <View style={styles.devchip}>
      <Ionicons name="mic" size={11} color={colors.ink3} />
      <Text style={styles.devText}>iPhone mic</Text>
      <MicMeter live={live} />
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.red },
  meter: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 13 },
  devchip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  devText: { fontSize: 10.5, fontWeight: "600", color: colors.ink2 },
});
