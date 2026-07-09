import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, {
  interpolate,
  type SharedValue,
  useAnimatedStyle,
} from "react-native-reanimated";

import { colors, font, radius, space } from "@/lib/theme";

export type SwipeAction = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress: () => void;
};

// One swipe action. Reads the swipeable's `progress` shared value so the button
// parallaxes + scales in *with* the drag (Emil: enter with ease-out feel, tied to
// the gesture, not a rigid reveal). Staggered by index; press gives 0.94 feedback.
function SwipeActionButton({
  action,
  progress,
  index,
  onRun,
}: {
  action: SwipeAction;
  progress: SharedValue<number>;
  index: number;
  onRun: () => void;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.5, 1], [0, 0.5, 1], "clamp"),
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [34 + index * 16, 0], "clamp") },
      { scale: interpolate(progress.value, [0, 1], [0.88, 1], "clamp") },
    ],
  }));

  return (
    <Animated.View style={[styles.actionWrap, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={action.label}
        onPress={onRun}
        style={({ pressed }) => [
          styles.action,
          { backgroundColor: action.color },
          pressed && styles.actionPressed,
        ]}
      >
        <Ionicons name={action.icon} size={18} color={colors.white} />
        <Text style={styles.actionLabel}>{action.label}</Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Wraps a list row with native swipe-left-to-reveal actions (Rename / Delete …).
 * ReanimatedSwipeable drives the drag on the UI thread; each action animates in
 * with the drag progress for a smooth, physical reveal. Tapping an action closes
 * the row first, then runs it. Requires a GestureHandlerRootView at the app root.
 */
export function SwipeableRow({
  children,
  actions,
}: {
  children: ReactNode;
  actions: SwipeAction[];
}) {
  const ref = useRef<SwipeableMethods>(null);

  const renderRightActions = (progress: SharedValue<number>) => (
    <View style={styles.actions}>
      {actions.map((a, i) => (
        <SwipeActionButton
          key={a.label}
          action={a}
          progress={progress}
          index={i}
          onRun={() => {
            ref.current?.close();
            a.onPress();
          }}
        />
      ))}
    </View>
  );

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={1.6}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={renderRightActions}
      containerStyle={styles.container}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: radius.lg, borderCurve: "continuous" },
  actions: { flexDirection: "row", alignItems: "stretch", gap: space.xs, paddingLeft: space.xs },
  actionWrap: { borderRadius: radius.lg, borderCurve: "continuous", overflow: "hidden" },
  action: {
    flex: 1,
    width: 74,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  actionPressed: { opacity: 0.9, transform: [{ scale: 0.94 }] },
  actionLabel: { ...font.label, color: colors.white, fontWeight: "700" },
});
