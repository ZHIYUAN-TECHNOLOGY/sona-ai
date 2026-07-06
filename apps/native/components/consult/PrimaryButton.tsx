import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, glowShadow } from "@/lib/theme";

export type ButtonVariant = "primary" | "ghost" | "danger";

export function PrimaryButton({
  label,
  onPress,
  variant = "primary",
  size = "md",
  icon,
  style,
  disabled = false,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  icon?: ReactNode;
  style?: object;
  disabled?: boolean;
}) {
  const isPrimary = variant === "primary";
  const isDanger = variant === "danger";
  const bg = isDanger ? colors.red : isPrimary ? colors.green : colors.bg;
  const fg = variant === "ghost" ? colors.ink : colors.white;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        size === "sm" ? styles.sm : styles.md,
        { backgroundColor: bg },
        variant === "ghost" && styles.ghostBorder,
        (isPrimary || isDanger) && glowShadow,
        isDanger && styles.dangerShadow,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <View style={styles.inner}>
        {icon}
        <Text style={[styles.label, size === "sm" && styles.labelSm, { color: fg }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  md: { paddingVertical: 13 },
  sm: { paddingVertical: 10, borderRadius: 11 },
  ghostBorder: { borderWidth: 1, borderColor: colors.lineStrong },
  dangerShadow: { shadowColor: colors.red, shadowOpacity: 0.28 },
  inner: { flexDirection: "row", alignItems: "center", gap: 7 },
  label: { fontSize: 13.5, fontWeight: "600" },
  labelSm: { fontSize: 12 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.4 },
});
