import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { colors } from "@/lib/theme";
import { RedactChip } from "./RedactChip";

// The redaction "sweep": a real identifier is shown briefly (amber highlight),
// a scan bar wipes across it, then it flips to the dark de-identified token chip
// (NAME_1, IC_1). Staggered top-to-bottom so the whole transcript looks scanned.
//
// Presentation-only. The real value comes from the on-device reidMap that this
// screen already displays; nothing new crosses the privacy boundary. When the
// user prefers reduced motion we render the final token chip immediately.
export function RedactSweepChip({
  token,
  real,
  index = 0,
  reduce = false,
}: {
  token: string;
  real: string;
  index?: number;
  reduce?: boolean;
}) {
  const [done, setDone] = useState(reduce);
  const [w, setW] = useState(0);
  const p = useSharedValue(0);

  useEffect(() => {
    if (reduce) return;
    p.value = withDelay(
      index * 190,
      withTiming(1, { duration: 440, easing: Easing.inOut(Easing.ease) }, (fin) => {
        if (fin) runOnJS(setDone)(true);
      }),
    );
  }, [index, p, reduce]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(p.value, [0, 0.5, 1], [1, 1.05, 1]) }],
  }));

  const barStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.12, 0.85, 1], [0, 0.95, 0.95, 0]),
    transform: [{ translateX: interpolate(p.value, [0, 1], [-w * 0.6, w]) }],
  }));

  if (done) {
    return (
      <Animated.View entering={FadeIn.duration(190)}>
        <RedactChip token={token} />
      </Animated.View>
    );
  }

  return (
    <Animated.View
      style={[styles.pill, pillStyle]}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
    >
      <Text style={styles.real} numberOfLines={1}>
        {real}
      </Text>
      {w > 0 && (
        <Animated.View pointerEvents="none" style={[styles.bar, { width: w * 0.5 }, barStyle]} />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    backgroundColor: colors.amber50,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.amberLine,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: "hidden",
    justifyContent: "center",
  },
  real: { color: colors.amber, fontSize: 10.5, fontWeight: "700", letterSpacing: 0.2 },
  bar: {
    position: "absolute",
    top: 0,
    bottom: 0,
    backgroundColor: colors.amber,
    borderRadius: 6,
  },
});
