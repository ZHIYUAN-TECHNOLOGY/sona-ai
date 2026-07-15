import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { haptic } from "@/lib/haptics";
import { colors, radius } from "@/lib/theme";

/** iOS-style on/off switch matching the prototype's green toggle. */
export function Toggle({
  value,
  onValueChange,
}: {
  value: boolean;
  onValueChange?: (v: boolean) => void;
}) {
  const reduce = useReducedMotion();
  const x = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(x, {
      toValue: value ? 1 : 0,
      // Reduced motion: the knob jumps states instead of sliding.
      duration: reduce ? 0 : 200,
      useNativeDriver: true,
    }).start();
  }, [value, x, reduce]);

  const translateX = x.interpolate({ inputRange: [0, 1], outputRange: [2.5, 17] });

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => {
        haptic("select");
        onValueChange?.(!value);
      }}
      style={({ pressed }) => [
        styles.track,
        { backgroundColor: value ? colors.green : colors.lineStrong },
        // The switch confirms the touch the instant it lands, like a real control.
        pressed && styles.pressed,
      ]}
    >
      <Animated.View style={[styles.knob, { transform: [{ translateX }] }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 38,
    height: 23,
    borderRadius: radius.pill,
    justifyContent: "center",
  },
  pressed: { transform: [{ scale: 0.94 }], opacity: 0.9 },
  knob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.white,
    boxShadow: "0px 1px 3px rgba(0,0,0,0.25)",
  },
});
