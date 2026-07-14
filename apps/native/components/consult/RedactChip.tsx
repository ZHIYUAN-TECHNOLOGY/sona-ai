import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { redaction, redactionClassOf } from "@/lib/theme";

/**
 * The "redacted identifier" chip (NAME_1, IC_1, …) shown inline in the
 * de-identified transcript. Color-coded by identifier class via the app-wide
 * theme.redaction palette (same codes as the scan review de-identified view).
 */
export function RedactChip({ token }: { token: string }) {
  const c = redaction[redactionClassOf(token)];
  return (
    <View style={[styles.chip, { backgroundColor: c.fg }]}>
      <Ionicons name="lock-closed" size={9} color="#ffffff" />
      <Text style={styles.text}>{token}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  text: {
    color: "#ffffff",
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
});
