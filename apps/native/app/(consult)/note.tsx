import { router } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { ConsultScreen } from "@/components/consult/ConsultScreen";
import { Pill } from "@/components/consult/Pill";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { SafetyNotice } from "@/components/consult/SafetyNotice";
import { SectionLabel } from "@/components/consult/SectionLabel";
import { useConsultPipeline } from "@/lib/pipeline/PipelineProvider";
import { colors } from "@/lib/theme";

// Screen 4 of 6 — Consult note. The SOAP note is generated ON-DEVICE (Qwen3-1.7B)
// from the de-identified transcript, then re-identified locally for review. The
// model never sees real identifiers; the re-ID map never leaves the device.
export default function NoteScreen() {
  const { redaction, note, noteStatus, noteError, draftNote, llmReady, llmProgress } =
    useConsultPipeline();

  // Draft once, when a redaction is ready and the on-device model has loaded.
  useEffect(() => {
    if (noteStatus === "idle" && redaction && llmReady) void draftNote();
  }, [noteStatus, redaction, llmReady, draftNote]);

  const ready = noteStatus === "ready" && note;

  return (
    <ConsultScreen
      time="9:45"
      title="Consult note"
      sub="Draft, review before signing"
      onBack={() => router.back()}
      right={<Pill label="Unsigned" variant="amber" />}
      footer={
        ready ? (
          <PrimaryButton label="Looks right" onPress={() => router.push("/sign")} />
        ) : undefined
      }
    >
      <View style={styles.chiprow}>
        <Pill label="GP follow-up · URTI" variant="green" />
        <Pill label="On-device model" variant="line" />
      </View>

      {!ready ? (
        <Card>
          {noteStatus === "error" ? (
            <View style={styles.center}>
              <Text style={styles.errTitle}>Note generation failed</Text>
              <Text style={styles.errBody}>{noteError ?? "Unknown error"}</Text>
              <PrimaryButton
                label="Try again"
                size="sm"
                style={styles.retry}
                onPress={() => void draftNote()}
              />
            </View>
          ) : (
            <View style={styles.center}>
              <ActivityIndicator color={colors.green} />
              <Text style={styles.loadTitle}>
                {!llmReady
                  ? `Loading on-device model… ${Math.round(llmProgress * 100)}%`
                  : "Drafting SOAP note on-device…"}
              </Text>
              <Text style={styles.loadSub}>
                Qwen3-1.7B · de-identified transcript in, note out. Nothing leaves the phone.
              </Text>
            </View>
          )}
        </Card>
      ) : (
        <>
          <Card>
            <SectionLabel>Subjective</SectionLabel>
            <Text style={styles.p}>{note.soap.subjective || "—"}</Text>

            <SectionLabel style={styles.h}>Objective</SectionLabel>
            <Text style={styles.p}>{note.soap.objective || "—"}</Text>

            <SectionLabel style={styles.h}>Assessment</SectionLabel>
            <Text style={styles.p}>{note.soap.assessment || "—"}</Text>

            <SectionLabel style={styles.h}>Plan</SectionLabel>
            <Text style={styles.p}>{note.soap.plan || "—"}</Text>

            {note.orders.length > 0 ? (
              <>
                <SectionLabel style={styles.h}>Orders &amp; follow-ups</SectionLabel>
                <View style={styles.orders}>
                  {note.orders.map((o, i) => (
                    <View key={i} style={styles.orderRow}>
                      <View style={styles.bullet} />
                      <Text style={styles.p}>{o.text}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </Card>

          <SafetyNotice>
            AI-drafted from this consult only. Review every line before signing. Not a diagnosis.
          </SafetyNotice>
        </>
      )}
    </ConsultScreen>
  );
}

const styles = StyleSheet.create({
  chiprow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 2 },
  center: { alignItems: "center", gap: 8, paddingVertical: 22 },
  loadTitle: { fontSize: 13, fontWeight: "600", color: colors.ink, marginTop: 4 },
  loadSub: { fontSize: 11, color: colors.ink3, textAlign: "center", lineHeight: 16 },
  errTitle: { fontSize: 13, fontWeight: "600", color: colors.red },
  errBody: { fontSize: 11, color: colors.ink2, textAlign: "center", lineHeight: 16 },
  retry: { marginTop: 6 },
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
});
