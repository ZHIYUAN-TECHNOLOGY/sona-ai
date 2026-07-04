import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { ConsultScreen } from "@/components/consult/ConsultScreen";
import { consult } from "@/components/consult/mockData";
import { Pill } from "@/components/consult/Pill";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { CardHeading } from "@/components/consult/SectionLabel";
import { Steps } from "@/components/consult/Steps";
import { Toggle } from "@/components/consult/Toggle";
import { colors } from "@/lib/theme";

// Screen 1 of 6 — Consent + audit start.
export default function ConsentScreen() {
  const [sealConsent, setSealConsent] = useState(true);
  const start = () => router.push("/recording");

  return (
    <ConsultScreen
      time="9:41"
      title="New consult"
      sub={consult.room}
      right={<Pill label="On-device" variant="green" dot />}
      footer={<PrimaryButton label="Start consult" onPress={start} />}
      tabBar={{ activeKey: "home", onRecord: start }}
    >
      <Card variant="green">
        <CardHeading>Patient consent</CardHeading>
        <Text style={styles.consentQuote}>“{consult.consentText}”</Text>
        <Text style={styles.body}>Consent is captured spoken, in the first ten seconds.</Text>
        <View style={styles.row}>
          <Text style={styles.micro}>Seal consent line in the audit log</Text>
          <Toggle value={sealConsent} onValueChange={setSealConsent} />
        </View>
      </Card>

      <Card variant="tint">
        <CardHeading>Where this consult lives</CardHeading>
        <Text style={styles.body}>
          Audio, transcript and identifiers stay on this phone. Audio is deleted the moment you sign.
        </Text>
        <View style={styles.chiprow}>
          <Pill label="Works offline" variant="green" />
          <Pill label="0 bytes to cloud" variant="line" />
        </View>
      </Card>

      <Card>
        <Steps
          items={["Record the consult", "Names removed on-device", "Review, sign, export"]}
        />
      </Card>
    </ConsultScreen>
  );
}

const styles = StyleSheet.create({
  consentQuote: {
    marginTop: 6,
    fontSize: 13,
    fontStyle: "italic",
    color: colors.greenInk,
    lineHeight: 19,
  },
  body: { marginTop: 5, fontSize: 11.5, color: colors.ink2, lineHeight: 17 },
  row: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  micro: { flex: 1, fontSize: 10.5, color: colors.ink3 },
  chiprow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 9 },
});
