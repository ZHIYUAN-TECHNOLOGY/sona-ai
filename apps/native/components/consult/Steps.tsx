import { StyleSheet, Text, View } from "react-native";

import { colors } from "@/lib/theme";

/** Numbered "what happens next" list on the consent screen. */
export function Steps({ items }: { items: string[] }) {
  return (
    <View style={styles.wrap}>
      {items.map((label, i) => (
        <View key={i} style={[styles.step, i > 0 && styles.divider]}>
          <View style={styles.sn}>
            <Text style={styles.snText}>{i + 1}</Text>
          </View>
          <Text style={styles.label}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 4 },
  step: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  sn: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.green50,
    alignItems: "center",
    justifyContent: "center",
  },
  snText: { fontSize: 10.5, fontWeight: "700", color: colors.greenInk },
  label: { flex: 1, fontSize: 12, color: colors.ink2 },
});
