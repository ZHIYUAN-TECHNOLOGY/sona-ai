import { StyleSheet, Text, View } from "react-native";

import { colors, radius } from "@/lib/theme";

export type PillVariant = "green" | "red" | "amber" | "blue" | "line";

const VARIANTS: Record<PillVariant, { color: string; bg: string; border: string }> = {
  green: { color: colors.greenInk, bg: colors.green50, border: colors.green100 },
  red: { color: colors.red, bg: colors.red50, border: colors.redLine },
  amber: { color: colors.amber, bg: colors.amber50, border: colors.amberLine },
  blue: { color: colors.blue, bg: colors.blue50, border: colors.blueLine },
  line: { color: colors.ink2, bg: colors.bg, border: colors.line },
};

export function Pill({
  label,
  variant = "green",
  dot = false,
}: {
  label: string;
  variant?: PillVariant;
  dot?: boolean;
}) {
  const v = VARIANTS[variant];
  return (
    <View style={[styles.pill, { backgroundColor: v.bg, borderColor: v.border }]}>
      {dot ? <View style={[styles.dot, { backgroundColor: v.color }]} /> : null}
      <Text style={[styles.text, { color: v.color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingVertical: 3,
    paddingHorizontal: 9,
    alignSelf: "flex-start",
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 10.5, fontWeight: "600" },
});
