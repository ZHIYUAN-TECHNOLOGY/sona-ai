import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text } from "react-native";

import { colors, font, radius, space } from "@/lib/theme";

/** A compact search affordance (display-only for the demo). */
export function SearchField({
  placeholder = "Search consults",
  onPress,
}: {
  placeholder?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="search"
      onPress={onPress}
      style={({ pressed }) => [styles.field, pressed && styles.pressed]}
    >
      <Ionicons name="search" size={17} color={colors.ink3} />
      <Text style={styles.placeholder}>{placeholder}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderCurve: "continuous",
    paddingVertical: space.md,
    paddingHorizontal: space.md,
  },
  pressed: { opacity: 0.7 },
  placeholder: { ...font.body, color: colors.ink3 },
});
