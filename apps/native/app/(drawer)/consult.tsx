import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { Pill } from "@/components/consult/Pill";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { CardHeading } from "@/components/consult/SectionLabel";
import { colors } from "@/lib/theme";

// Drawer entry point that launches the 6-screen consult demo flow. Kept thin —
// the flow itself lives under app/(consult)/. This sits alongside the spike home
// (drawer index), which is untouched.
export default function ConsultLauncher() {
  return (
    <View style={styles.wrap}>
      <View style={styles.brandRow}>
        <View style={styles.mark}>
          <Text style={styles.markText}>S</Text>
        </View>
        <View>
          <Text style={styles.brand}>Sona</Text>
          <Text style={styles.brandSub}>On-device medical scribe</Text>
        </View>
      </View>

      <Card variant="green">
        <CardHeading>Locked demo consult</CardHeading>
        <Text style={styles.body}>
          Encik Rahman, 58 — cough follow-up. Bahasa Malaysia + English, radio off from the first
          second. Walk the six-screen slice end to end.
        </Text>
        <View style={styles.chiprow}>
          <Pill label="On-device" variant="green" dot />
          <Pill label="0 bytes to cloud" variant="line" />
        </View>
      </Card>

      <PrimaryButton
        label="Start the consult demo"
        icon={<Ionicons name="play" size={16} color={colors.white} />}
        onPress={() => router.push("/consent")}
        style={styles.cta}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: 20, gap: 16 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 },
  mark: {
    width: 40,
    height: 40,
    borderRadius: 11,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  markText: { color: colors.white, fontWeight: "700", fontSize: 18 },
  brand: { fontSize: 18, fontWeight: "700", color: colors.ink },
  brandSub: { fontSize: 12, color: colors.ink3, marginTop: 1 },
  body: { marginTop: 6, fontSize: 12.5, color: colors.ink2, lineHeight: 18 },
  chiprow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  cta: { marginTop: 4 },
});
