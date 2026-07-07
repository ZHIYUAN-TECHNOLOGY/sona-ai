import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Share, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { ConsultScreen } from "@/components/consult/ConsultScreen";
import { consult } from "@/components/consult/mockData";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { CardHeading } from "@/components/consult/SectionLabel";
import { toFhirDocumentReference } from "@/lib/export/fhir";
import { assertReidentified, toNoteText } from "@/lib/export/noteText";
import { exportPdf } from "@/lib/export/pdf";
import type { SignedNote } from "@/lib/export/types";
import { recordExport, signConsult } from "@/lib/pipeline/consultPipeline";
import { useConsultPipeline } from "@/lib/pipeline/PipelineProvider";
import { colors } from "@/lib/theme";

type ExportKind = "FHIR R4" | "PDF" | "Copy";

// Screen 5 of 6 — Sign & export. Signs the on-device note, discards the raw audio,
// and exports a re-identified FHIR R4 / PDF / text artefact. assertReidentified is
// the last gate: it throws if any redaction token survived, so a leaked token can
// never be exported.
export default function SignScreen() {
  const { note, consultId, redaction } = useConsultPipeline();
  const [signed, setSigned] = useState(false);
  const [signedAt, setSignedAt] = useState<string | null>(null);
  // FHIR R4 is the default export destination (standards-based EMR ingest) and is
  // shown pre-selected + prominent; tapping any destination selects it and exports.
  const [selectedExport, setSelectedExport] = useState<ExportKind>("FHIR R4");

  const buildSignedNote = (): SignedNote | null => {
    if (!note || !consultId) return null;
    return {
      consultId,
      patientDisplayName: redaction?.reidMap?.["NAME_1"] ?? "Patient",
      clinicianName: consult.clinicianName,
      mmcNo: consult.mmcNo,
      signedAtISO: signedAt ?? new Date().toISOString(),
      soap: note.soap,
      orders: note.orders,
    };
  };

  const onPrimary = async () => {
    if (signed) {
      router.push("/complete");
      return;
    }
    if (!consultId) return;
    setSignedAt(new Date().toISOString());
    setSigned(true);
    await signConsult(consultId, consult.clinicianName);
  };

  const doExport = async (kind: ExportKind) => {
    const signedNote = buildSignedNote();
    if (!signedNote || !consultId) return;
    try {
      assertReidentified(signedNote); // throws if any NAME_1/IC_1 token remains
      if (kind === "FHIR R4") {
        await Share.share({ message: JSON.stringify(toFhirDocumentReference(signedNote), null, 2) });
      } else if (kind === "PDF") {
        const uri = await exportPdf(signedNote);
        await Share.share({ url: uri });
      } else {
        await Share.share({ message: toNoteText(signedNote) });
      }
      await recordExport(consultId, kind);
    } catch (e) {
      Alert.alert("Export blocked", e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <ConsultScreen
      time="9:47"
      title="Sign & export"
      sub={`${consult.clinicianName} · ${consult.mmcNo}`}
      onBack={() => router.back()}
      footer={
        <PrimaryButton
          label={signed ? "Finish consult" : "Sign and finish"}
          onPress={onPrimary}
        />
      }
    >
      <Card>
        <CardHeading>Signature</CardHeading>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign here"
          onPress={onPrimary}
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
          {(["FHIR R4", "PDF", "Copy"] as ExportKind[]).map((label) => (
            <PrimaryButton
              key={label}
              label={label}
              variant={selectedExport === label ? "primary" : "ghost"}
              size="sm"
              style={styles.grow}
              disabled={!signed}
              onPress={() => {
                setSelectedExport(label);
                void doExport(label);
              }}
            />
          ))}
        </View>
        <Text style={styles.micro}>
          {signed
            ? `${selectedExport} selected · re-identified, ready for any EMR ingest`
            : `Sign to unlock export · ${selectedExport} selected by default`}
        </Text>
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
