import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { colors } from "@/lib/theme";

/** Amber "review before use" clinician-in-the-loop safety banner. */
export function SafetyNotice({ children }: { children: string }) {
  return (
    <View style={styles.wrap}>
      <Ionicons name="warning-outline" size={15} color={colors.amber} />
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.amber50,
    borderWidth: 1,
    borderColor: colors.amberLine,
    borderRadius: 10,
    borderCurve: "continuous",
    paddingVertical: 8,
    paddingHorizontal: 11,
    marginTop: 9,
  },
  text: { flex: 1, fontSize: 10.5, fontWeight: "600", color: colors.amber, lineHeight: 15 },
});
