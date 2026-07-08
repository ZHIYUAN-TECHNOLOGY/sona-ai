import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, font, space } from "@/lib/theme";

/** A labelled settings row: leading icon, label, and a right value / chevron / accessory. */
export function SettingsRow({
  icon,
  label,
  value,
  right,
  onPress,
  first = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  right?: ReactNode;
  onPress?: () => void;
  first?: boolean;
}) {
  const Wrapper: typeof Pressable | typeof View = onPress ? Pressable : View;
  return (
    <Wrapper
      accessibilityRole={onPress ? "button" : undefined}
      onPress={onPress}
      style={[styles.row, !first && styles.divider]}
    >
      <Ionicons name={icon} size={19} color={colors.green} />
      <Text style={styles.label}>{label}</Text>
      <View style={styles.rightWrap}>
        {value ? <Text style={styles.value}>{value}</Text> : null}
        {right}
        {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.ink3} /> : null}
      </View>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
  },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  label: { ...font.body, color: colors.ink, flex: 1 },
  rightWrap: { flexDirection: "row", alignItems: "center", gap: space.sm },
  value: { ...font.bodySm, color: colors.ink3 },
});
