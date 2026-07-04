import { StyleSheet, Text, View } from "react-native";

import { colors, radius } from "@/lib/theme";

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
    paddingVertical: 16,
    paddingHorizontal: 12,
    backgroundColor: colors.green50,
    borderWidth: 1,
    borderColor: colors.green100,
    borderRadius: radius.md,
  },
  n: { fontSize: 32, fontWeight: "700", letterSpacing: -0.9, color: colors.greenDeep },
  l: { fontSize: 11, color: colors.ink2, marginTop: 2, textAlign: "center", lineHeight: 15 },
});
