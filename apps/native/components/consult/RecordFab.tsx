import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet } from "react-native";

import { colors, radius } from "@/lib/theme";

/**
 * Raised circular Record action, floated above the native liquid-glass tab bar
 * (NativeTabs forbids a custom center tab, so this is an overlay). Green + glow,
 * Emil 0.96 press. Starts a consult.
 */
export function RecordFab({
  onPress,
  accessibilityLabel = "Start consult",
}: {
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
    >
      <Ionicons name="mic" size={26} color={colors.white} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    width: 62,
    height: 62,
    borderRadius: radius.pill,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: colors.white,
    boxShadow: "0px 8px 18px rgba(14,124,82,0.42)",
  },
  pressed: { opacity: 0.92, transform: [{ scale: 0.96 }] },
});
