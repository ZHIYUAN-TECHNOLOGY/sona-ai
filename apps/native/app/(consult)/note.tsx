import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { ConsultScreen } from "@/components/consult/ConsultScreen";
import { note } from "@/components/consult/mockData";
import { Pill } from "@/components/consult/Pill";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { SafetyNotice } from "@/components/consult/SafetyNotice";
import { SectionLabel } from "@/components/consult/SectionLabel";
import { colors } from "@/lib/theme";

// Screen 4 of 6 — Consult note: SOAP + orders & follow-ups, template chip, safety notice.
export default function NoteScreen() {
  return (
    <ConsultScreen
      time="9:45"
      title="Consult note"
      sub="Draft, review before signing"
      onBack={() => router.back()}
      right={<Pill label="Unsigned" variant="amber" />}
      footer={
        <View style={styles.footerRow}>
          <PrimaryButton label="Edit" variant="ghost" size="sm" style={styles.grow} />
          <PrimaryButton
            label="Looks right"
            size="sm"
            style={styles.grow}
            onPress={() => router.push("/sign")}
          />
        </View>
      }
    >
      <View style={styles.chiprow}>
        <Pill label={note.template} variant="green" />
        <Pill label="On-device model" variant="line" />
      </View>

      <Card>
        <SectionLabel>Subjective</SectionLabel>
        <Text style={styles.p}>{note.soap.subjective}</Text>

        <SectionLabel style={styles.h}>Objective</SectionLabel>
        <Text style={styles.p}>{note.soap.objective}</Text>

        <SectionLabel style={styles.h}>Assessment</SectionLabel>
        <Text style={styles.p}>{note.soap.assessment}</Text>

        <SectionLabel style={styles.h}>Plan</SectionLabel>
        <Text style={styles.p}>{note.soap.plan}</Text>

        <SectionLabel style={styles.h}>Orders &amp; follow-ups</SectionLabel>
        <View style={styles.orders}>
          {note.orders.map((o, i) => (
            <View key={i} style={styles.orderRow}>
              <View style={styles.bullet} />
              <Text style={styles.p}>{o.text}</Text>
            </View>
          ))}
        </View>
      </Card>

      <SafetyNotice>{note.safetyNotice}</SafetyNotice>
    </ConsultScreen>
  );
}

const styles = StyleSheet.create({
  chiprow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 2 },
  h: { marginTop: 11 },
  p: { flex: 1, fontSize: 11.5, color: colors.ink2, lineHeight: 17, marginTop: 3 },
  orders: { marginTop: 2 },
  orderRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  bullet: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.green,
    marginTop: 9,
  },
  footerRow: { flexDirection: "row", gap: 8 },
  grow: { flex: 1 },
});
