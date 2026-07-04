import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { ConsultScreen } from "@/components/consult/ConsultScreen";
import { auditLog, proof } from "@/components/consult/mockData";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { CardHeading } from "@/components/consult/SectionLabel";
import { Stat } from "@/components/consult/Stat";
import { colors } from "@/lib/theme";

// Screen 6 of 6 — Consult complete: audit log + the "0 bytes" proof stat.
export default function CompleteScreen() {
  // "Next patient" restarts the flow at consent with a clean stack. Replacing the
  // top screen alone would leave the finished consult's recording/privacy/note/sign
  // screens on the (consult) stack, so dismiss them first.
  const nextPatient = () => {
    if (router.canDismiss?.()) router.dismissAll();
    router.replace("/consent");
  };

  return (
    <ConsultScreen
      time="9:47"
      title="Consult complete"
      sub={proof.duration}
      footer={<PrimaryButton label="Next patient" onPress={nextPatient} />}
      tabBar={{ activeKey: "home", onRecord: () => router.replace("/recording") }}
    >
      <Stat value={proof.bytesLabel} label={proof.bytesSub} />

      <Card>
        <CardHeading>Audit log</CardHeading>
        <View style={styles.log}>
          {auditLog.map((row, i) => (
            <View key={i} style={[styles.ar, i > 0 && styles.arDivider]}>
              <Text style={styles.t}>{row.time}</Text>
              <Ionicons name="checkmark" size={13} color={colors.green} />
              <Text style={styles.detail}>{row.detail}</Text>
            </View>
          ))}
        </View>
      </Card>
    </ConsultScreen>
  );
}

const styles = StyleSheet.create({
  log: { marginTop: 4 },
  ar: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  arDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  t: { width: 34, fontSize: 10.5, color: colors.ink3, fontVariant: ["tabular-nums"] },
  detail: { flex: 1, fontSize: 11, color: colors.ink2 },
});
