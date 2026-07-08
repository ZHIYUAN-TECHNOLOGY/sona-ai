import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { colors, shadow } from "@/lib/theme";

const SIZE = 116;

/**
 * The big circular record affordance (Heidi-inspired). Two rings pulse outward
 * while recording — Emil: subtle, ease-out, decorative. Honours reduced-motion.
 * Tap to stop/continue.
 */
export function RecordButton({
  recording = true,
  onPress,
  accessibilityLabel = "Stop recording",
}: {
  recording?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const reduced = useReducedMotion();
  const p = useSharedValue(0);

  useEffect(() => {
    if (recording && !reduced) {
      p.value = 0;
      p.value = withRepeat(withTiming(1, { duration: 2000, easing: Easing.out(Easing.ease) }), -1, false);
    } else {
      cancelAnimation(p);
      p.value = 0;
    }
    return () => cancelAnimation(p);
  }, [recording, reduced, p]);

  const ring1 = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + p.value * 0.55 }],
    opacity: 0.28 * (1 - p.value),
  }));
  const ring2 = useAnimatedStyle(() => {
    "worklet";
    const q = (p.value + 0.5) % 1;
    return { transform: [{ scale: 1 + q * 0.55 }], opacity: 0.2 * (1 - q) };
  });

  return (
    <View style={styles.wrap}>
      <Animated.View pointerEvents="none" style={[styles.ring, ring1]} />
      <Animated.View pointerEvents="none" style={[styles.ring, ring2]} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
      >
        <Ionicons name={recording ? "stop" : "mic"} size={40} color={colors.white} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" },
  ring: {
    position: "absolute",
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: colors.green,
  },
  btn: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: shadow.glow,
  },
  pressed: { opacity: 0.9, transform: [{ scale: 0.97 }] },
});
