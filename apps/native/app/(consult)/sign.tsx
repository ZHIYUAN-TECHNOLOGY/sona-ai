import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Share, StyleSheet, Text, View } from "react-native";

import { BottomSheet, SheetRow } from "@/components/consult/BottomSheet";
import { Card } from "@/components/consult/Card";
import { ConsultScreen } from "@/components/consult/ConsultScreen";
import { consult } from "@/components/consult/mockData";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { CardHeading } from "@/components/consult/SectionLabel";
import { toFhirDocumentReference } from "@/lib/export/fhir";
import { assertReidentified, toNoteText } from "@/lib/export/noteText";
import { exportPdf } from "@/lib/export/pdf";
import type { SignedNote } from "@/lib/export/types";
import { haptic } from "@/lib/haptics";
import { recordExport, signConsult } from "@/lib/pipeline/consultPipeline";
import { useConsultPipeline } from "@/lib/pipeline/PipelineProvider";
import { colors, font, radius, space } from "@/lib/theme";

type ExportKind = "FHIR R4" | "PDF" | "Copy";

// Screen 5 of 6 — Sign & export. Signs the on-device note, discards the raw audio,
// and exports a re-identified FHIR R4 / PDF / text artefact via a bottom sheet.
// assertReidentified is the last gate: it throws if any redaction token survived,
// so a leaked token can never be exported.
export default function SignScreen() {
  const { note, consultId, redaction } = useConsultPipeline();
  const [signed, setSigned] = useState(false);
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

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
    haptic("signSuccess");
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
      setSheetOpen(false);
    } catch (e) {
      Alert.alert("Export blocked", e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <ConsultScreen
        time="9:47"
        title="Sign & export"
        sub={`${consult.clinicianName} · ${consult.mmcNo}`}
        onBack={() => router.back()}
        footer={<PrimaryButton label={signed ? "Finish consult" : "Sign and finish"} onPress={onPrimary} />}
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
                <Ionicons name="create-outline" size={16} color={colors.ink3} />
                <Text style={styles.sigHintText}>Tap to sign</Text>
              </View>
            )}
          </Pressable>
        </Card>

        <Card variant="tint">
          <CardHeading>Export &amp; share</CardHeading>
          <Text style={styles.micro}>
            {signed
              ? "Re-identified on-device · ready for any EMR ingest"
              : "Sign to unlock export"}
          </Text>
          <PrimaryButton
            label="Export & share"
            variant="ghost"
            disabled={!signed}
            style={styles.exportBtn}
            icon={<Ionicons name="share-outline" size={17} color={colors.ink} />}
            onPress={() => setSheetOpen(true)}
          />
        </Card>

        <Card variant="danger">
          <CardHeading color={colors.red}>On sign, audio is destroyed</CardHeading>
          <Text style={styles.dangerBody}>
            The raw recording is deleted from this device. Only the signed note and audit log remain.
            Nothing was ever uploaded.
          </Text>
        </Card>
      </ConsultScreen>

      <BottomSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title="Export & share">
        <SheetRow first icon="git-branch-outline" label="FHIR R4 — EMR ingest" onPress={() => doExport("FHIR R4")} />
        <SheetRow icon="document-text-outline" label="Download PDF" onPress={() => doExport("PDF")} />
        <SheetRow icon="copy-outline" label="Copy note text" onPress={() => doExport("Copy")} />
        <Text style={styles.sheetNote}>Re-identified on-device · nothing was uploaded.</Text>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  sig: {
    height: 64,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    marginTop: space.md,
  },
  sigSigned: { borderStyle: "solid", borderColor: colors.green100, backgroundColor: colors.green50 },
  sigMark: { ...font.h3, color: colors.green, fontStyle: "italic" },
  sigHint: { flexDirection: "row", alignItems: "center", gap: space.sm },
  sigHintText: { ...font.bodySm, color: colors.ink3 },
  micro: { marginTop: space.sm, ...font.bodySm, color: colors.ink3 },
  exportBtn: { marginTop: space.md },
  dangerBody: { marginTop: space.xs, ...font.bodySm, color: colors.ink2 },
  sheetNote: { ...font.bodySm, color: colors.ink3, marginTop: space.md },
});
