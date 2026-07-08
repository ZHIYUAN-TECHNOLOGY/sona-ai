import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { ConsultScreen } from "@/components/consult/ConsultScreen";
import { NoteMarkdown } from "@/components/consult/NoteMarkdown";
import { Pill } from "@/components/consult/Pill";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { SafetyNotice } from "@/components/consult/SafetyNotice";
import { NOTE_MODEL_NAME } from "@/lib/pipeline/model";
import { noteIsEmpty } from "@/lib/pipeline/noteHighlight";
import { useConsultPipeline } from "@/lib/pipeline/PipelineProvider";
import { templateById } from "@/lib/pipeline/templates";
import { colors, font, space } from "@/lib/theme";

// Screen 4 of 6 — Consult note. The note is generated ON-DEVICE from the
// de-identified transcript, re-identified locally, and rendered as rich Markdown.
// The model never sees real identifiers; the re-ID map never leaves the device.
export default function NoteScreen() {
  const { redaction, note, noteStatus, noteError, draftNote, llmReady, llmProgress, templateId } =
    useConsultPipeline();

  // Draft once, when a redaction is ready and the on-device model has loaded.
  useEffect(() => {
    if (noteStatus === "idle" && redaction && llmReady) void draftNote();
  }, [noteStatus, redaction, llmReady, draftNote]);

  const ready = noteStatus === "ready" && note;
  const empty = !!ready && noteIsEmpty(note.markdown);

  return (
    <ConsultScreen
      time="9:45"
      title="Consult note"
      sub="Draft, review before signing"
      onBack={() => router.back()}
      right={<Pill label="Unsigned" variant="amber" />}
      footer={
        ready && !empty ? (
          <PrimaryButton label="Looks right" onPress={() => router.push("/sign")} />
        ) : undefined
      }
    >
      <View style={styles.chiprow}>
        <Pill label={note?.title ?? "Consult note"} variant="green" />
        <Pill label={templateById(templateId).name} variant="line" />
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
                  : "Drafting note on-device…"}
              </Text>
              <Text style={styles.loadSub}>
                {NOTE_MODEL_NAME} · de-identified transcript in, note out. Nothing leaves the phone.
              </Text>
            </View>
          )}
        </Card>
      ) : empty ? (
        <Card>
          <View style={styles.center}>
            <Ionicons name="document-text-outline" size={30} color={colors.ink3} />
            <Text style={styles.loadTitle}>Not enough to draft a note</Text>
            <Text style={styles.loadSub}>
              This consult was too short for the model to draft a note. Record a longer
              conversation, then try again.
            </Text>
            <PrimaryButton
              label="Try again"
              size="sm"
              style={styles.retry}
              onPress={() => void draftNote()}
            />
          </View>
        </Card>
      ) : (
        <>
          <Card>
            <NoteMarkdown markdown={note.markdown} />
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
  chiprow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginBottom: space.xs },
  center: { alignItems: "center", gap: space.sm, paddingVertical: space.xl },
  loadTitle: { ...font.body, fontWeight: "600", color: colors.ink, marginTop: space.xs },
  loadSub: { ...font.bodySm, color: colors.ink3, textAlign: "center" },
  errTitle: { ...font.body, fontWeight: "600", color: colors.red },
  errBody: { ...font.bodySm, color: colors.ink2, textAlign: "center" },
  retry: { marginTop: space.sm },
});
