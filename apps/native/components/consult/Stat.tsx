import { StyleSheet, Text, View } from "react-native";

import { colors, font, radius, space } from "@/lib/theme";

/** The headline proof stat (e.g. "0 bytes") on the complete screen. */
export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.n}>{value}</Text>
      <Text style={styles.l}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stat: {
    alignItems: "center",
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    backgroundColor: colors.greenSoft,
    borderWidth: 1,
    borderColor: colors.green100,
    borderRadius: radius.lg,
    borderCurve: "continuous",
  },
  // Serif hero (Fraunces) — the "0 bytes" proof.
  n: { ...font.hero, color: colors.greenDeep },
  l: { ...font.bodySm, color: colors.ink2, marginTop: 4, textAlign: "center" },
});
