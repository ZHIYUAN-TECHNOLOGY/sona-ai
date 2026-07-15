import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { haptic } from "@/lib/haptics";
import { colors, radius, shadow } from "@/lib/theme";

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
  const bg = isDanger ? colors.red : isPrimary ? colors.green : colors.card;
  const fg = variant === "ghost" ? colors.ink : colors.white;
  const glow = isPrimary || isDanger;

  // A light tap on the primary CTA; danger warns (destructive weight); ghost stays silent.
  const press = () => {
    if (!isPrimary && !isDanger) return onPress?.();
    haptic(isDanger ? "warn" : "tap");
    onPress?.();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={press}
      style={({ pressed }) => [
        styles.btn,
        size === "sm" ? styles.sm : styles.md,
        { backgroundColor: bg },
        variant === "ghost" && styles.ghostBorder,
        glow && !disabled && (isDanger ? styles.dangerGlow : styles.glow),
        // Emil: 0.97 press feedback — the button confirms it heard the tap.
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
    borderRadius: radius.md,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
  },
  // Horizontal padding matters when the button is content-width (not stretched),
  // e.g. centered in an empty state. Full-width buttons stretch past it anyway.
  md: { paddingVertical: 15, paddingHorizontal: 24 },
  sm: { paddingVertical: 11, paddingHorizontal: 18, borderRadius: radius.sm },
  ghostBorder: { borderWidth: 1, borderColor: colors.lineStrong },
  glow: { boxShadow: shadow.glow },
  dangerGlow: { boxShadow: "0px 8px 20px rgba(180,35,24,0.22)" },
  inner: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { fontSize: 15, fontWeight: "600" },
  labelSm: { fontSize: 12.5 },
  pressed: { opacity: 0.9, transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.4 },
});
