import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";

import { colors, radius, space } from "@/lib/theme";

export type CardVariant = "default" | "tint" | "green" | "amber" | "danger";

const VARIANTS: Record<CardVariant, { bg: string; border: string }> = {
  default: { bg: colors.bg, border: colors.line },
  tint: { bg: colors.surface, border: colors.line },
  green: { bg: colors.green50, border: colors.green100 },
  amber: { bg: colors.amber50, border: colors.amberLine },
  danger: { bg: colors.red50, border: colors.redLine },
};

export function Card({
  children,
  variant = "default",
  style,
}: {
  children: ReactNode;
  variant?: CardVariant;
  style?: ViewStyle;
}) {
  const v = VARIANTS[variant];
  return (
    <View style={[styles.card, { backgroundColor: v.bg, borderColor: v.border }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.lg,
  },
});
