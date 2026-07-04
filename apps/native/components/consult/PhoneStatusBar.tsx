import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { colors, radius } from "@/lib/theme";

/**
 * In-app affordance strip that makes the "radio is off" claim visible at all
 * times: an Airplane-mode pill pinned top-right, echoing the prototype. The real
 * OS status bar still renders above this; this strip is the on-device proof cue.
 */
export function PhoneStatusBar({ time = "9:42" }: { time?: string }) {
  return (
    <View style={styles.bar}>
      <Text style={styles.time}>{time}</Text>
      <View style={styles.airplane}>
        <Ionicons name="airplane" size={11} color={colors.greenInk} />
        <Text style={styles.airplaneText}>Airplane</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 17,
    paddingTop: 6,
    paddingBottom: 4,
  },
  time: { fontSize: 12, fontWeight: "600", color: colors.ink },
  airplane: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.green50,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 2,
  },
  airplaneText: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.greenInk,
    letterSpacing: 0.1,
  },
});
