import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { ConsultScreen } from "@/components/consult/ConsultScreen";
import { consult } from "@/components/consult/mockData";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { CardHeading } from "@/components/consult/SectionLabel";
import { colors } from "@/lib/theme";

// Screen 5 of 6 — Sign & export: signature area (stubbed), FHIR/PDF/Copy,
// and the "audio destroyed on sign" card.
export default function SignScreen() {
  const [signed, setSigned] = useState(false);

  return (
    <ConsultScreen
      time="9:47"
      title="Sign & export"
      sub={`${consult.clinicianName} · ${consult.mmcNo}`}
      onBack={() => router.back()}
      footer={
        <PrimaryButton
          label={signed ? "Finish consult" : "Sign and finish"}
          onPress={() => (signed ? router.push("/complete") : setSigned(true))}
        />
      }
    >
      <Card>
        <CardHeading>Signature</CardHeading>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign here"
          onPress={() => setSigned((s) => !s)}
          style={[styles.sig, signed && styles.sigSigned]}
        >
          {signed ? (
            <Text style={styles.sigMark}>{consult.clinicianName}</Text>
          ) : (
            <View style={styles.sigHint}>
              <Ionicons name="create-outline" size={15} color={colors.ink3} />
              <Text style={styles.sigHintText}>Tap to sign</Text>
            </View>
          )}
        </Pressable>
      </Card>

      <Card variant="tint">
        <CardHeading>Export destinations</CardHeading>
        <View style={styles.exportRow}>
          {["FHIR R4", "PDF", "Copy"].map((label) => (
            <PrimaryButton
              key={label}
              label={label}
              variant="ghost"
              size="sm"
              style={styles.grow}
              onPress={() => Alert.alert("Export", `${label} export wires in on Day 4.`)}
            />
          ))}
        </View>
        <Text style={styles.micro}>DocumentReference plus Encounter, ready for any EMR ingest</Text>
      </Card>

      <Card variant="danger">
        <CardHeading color={colors.red}>On sign, audio is destroyed</CardHeading>
        <Text style={styles.dangerBody}>
          The raw recording is deleted from this device. Only the signed note and audit log remain.
          Nothing was ever uploaded.
        </Text>
      </Card>
    </ConsultScreen>
  );
}

const styles = StyleSheet.create({
  sig: {
    height: 58,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.lineStrong,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    marginTop: 9,
  },
  sigSigned: { borderStyle: "solid", borderColor: colors.green100, backgroundColor: colors.green50 },
  sigMark: {
    fontSize: 22,
    color: colors.green,
    fontStyle: "italic",
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  sigHint: { flexDirection: "row", alignItems: "center", gap: 6 },
  sigHintText: { fontSize: 12, color: colors.ink3 },
  exportRow: { flexDirection: "row", gap: 7, marginTop: 9 },
  grow: { flex: 1 },
  micro: { marginTop: 7, fontSize: 10.5, color: colors.ink3 },
  dangerBody: { marginTop: 5, fontSize: 11.5, color: colors.ink2, lineHeight: 17 },
});
