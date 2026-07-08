import { StyleSheet, Text, View, type ViewStyle } from "react-native";

import { colors, font } from "@/lib/theme";

/** Green uppercase overline used for SOAP section headings and small labels. */
export function SectionLabel({ children, style }: { children: string; style?: ViewStyle }) {
  return (
    <View style={style}>
      <Text style={styles.label}>{children}</Text>
    </View>
  );
}

/** A card's inline heading row (12px, semibold ink). */
export function CardHeading({ children, color }: { children: string; color?: string }) {
  return <Text style={[styles.cardHeading, color ? { color } : null]}>{children}</Text>;
}

const styles = StyleSheet.create({
  label: {
    ...font.label,
    color: colors.green,
  },
  cardHeading: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.ink,
  },
});
