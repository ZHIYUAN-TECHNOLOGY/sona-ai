import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet } from "react-native";

import { colors, radius } from "@/lib/theme";

/** iOS-style on/off switch matching the prototype's green toggle. */
export function Toggle({
  value,
  onValueChange,
}: {
  value: boolean;
  onValueChange?: (v: boolean) => void;
}) {
  const x = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(x, {
      toValue: value ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [value, x]);

  const translateX = x.interpolate({ inputRange: [0, 1], outputRange: [2.5, 17] });

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => onValueChange?.(!value)}
      style={[styles.track, { backgroundColor: value ? colors.green : colors.lineStrong }]}
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
  knob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.white,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});
