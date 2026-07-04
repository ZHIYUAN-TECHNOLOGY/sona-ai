import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { colors } from "@/lib/theme";

/**
 * The dark "redacted identifier" chip (NAME_1, IC_1, …) shown inline in the
 * de-identified transcript. Rendered as a small pill so it flows in text.
 */
export function RedactChip({ token }: { token: string }) {
  return (
    <View style={styles.chip}>
      <Ionicons name="lock-closed" size={9} color={colors.white} />
      <Text style={styles.text}>{token}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.ink,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  text: {
    color: colors.white,
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
});
