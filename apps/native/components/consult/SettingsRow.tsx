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
  onLongPress,
  first = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  right?: ReactNode;
  onPress?: () => void;
  /** Optional hidden affordance (e.g. dev/demo unlock) — no chevron is shown for it. */
  onLongPress?: () => void;
  first?: boolean;
}) {
  const inner = (
    <>
      <Ionicons name={icon} size={19} color={colors.green} />
      <Text style={styles.label}>{label}</Text>
      <View style={styles.rightWrap}>
        {value ? <Text style={styles.value}>{value}</Text> : null}
        {right}
        {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.ink3} /> : null}
      </View>
    </>
  );
  if (!onPress && !onLongPress)
    return <View style={[styles.row, !first && styles.divider]}>{inner}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={onLongPress ? 600 : undefined}
      // The row acknowledges the touch instantly (iOS list-row dim). A row with
      // only a hidden long-press stays visually static — no press dim, no chevron.
      style={({ pressed }) => [
        styles.row,
        !first && styles.divider,
        onPress && pressed && styles.pressed,
      ]}
    >
      {inner}
    </Pressable>
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
  pressed: { opacity: 0.55 },
  label: { ...font.body, color: colors.ink, flex: 1 },
  rightWrap: { flexDirection: "row", alignItems: "center", gap: space.sm },
  value: { ...font.bodySm, color: colors.ink3 },
});
