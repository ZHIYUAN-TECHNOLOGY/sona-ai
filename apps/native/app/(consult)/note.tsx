import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown, useReducedMotion } from "react-native-reanimated";

import { Card } from "@/components/consult/Card";
import { ConsultScreen } from "@/components/consult/ConsultScreen";
import { NoteEditor } from "@/components/consult/NoteEditor";
import { NoteMarkdown } from "@/components/consult/NoteMarkdown";
import { Pill } from "@/components/consult/Pill";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { SafetyNotice } from "@/components/consult/SafetyNotice";
import { haptic } from "@/lib/haptics";
import { NOTE_MODEL_NAME } from "@/lib/pipeline/model";
import { noteIsEmpty } from "@/lib/pipeline/noteHighlight";
import { useConsultPipeline } from "@/lib/pipeline/PipelineProvider";
import { templateById } from "@/lib/pipeline/templates";
import { colors, font, space } from "@/lib/theme";

// Screen 4 of 6 — Consult note. The note is generated ON-DEVICE from the
// de-identified transcript, re-identified locally, and rendered as rich Markdown.
// The model never sees real identifiers; the re-ID map never leaves the device.
export default function NoteScreen() {
  const {
    redaction,
    note,
    noteStatus,
    noteError,
    draftNote,
    editNote,
    llmReady,
    llmProgress,
    templateId,
  } = useConsultPipeline();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Draft once, when a redaction is ready and the on-device model has loaded.
  useEffect(() => {
    if (noteStatus === "idle" && redaction && llmReady) void draftNote();
  }, [noteStatus, redaction, llmReady, draftNote]);

  // A success tap the moment the on-device note lands.
  useEffect(() => {
    if (noteStatus === "ready") haptic("noteReady");
  }, [noteStatus]);

  const ready = noteStatus === "ready" && note;
  const empty = !!ready && noteIsEmpty(note.markdown);

  const saveEdit = async (edited: string) => {
    setSaving(true);
    try {
      await editNote(edited);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  // Elegant reveal for the drafted note: a gentle fade + short rise on a strong
  // ease-out curve (no spring/bounce — this is a document, not a toast). The
  // safety notice settles just after. Reduced motion → opacity-only fade.
  const reduce = useReducedMotion();
  const revealNote = reduce
    ? FadeIn.duration(220)
    : FadeInDown.duration(460).easing(Easing.bezier(0.23, 1, 0.32, 1)).withInitialValues({
        transform: [{ translateY: 14 }],
      });
  const revealNotice = reduce ? FadeIn.duration(220) : FadeIn.delay(180).duration(340);

  return (
    <ConsultScreen
      time="9:45"
      title="Consult note"
      sub="Draft, review before signing"
      onBack={() => router.back()}
      right={<Pill label="Unsigned" variant="amber" />}
      footer={
        ready && !empty && !editing ? (
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
        <Animated.View entering={FadeIn.duration(300)}>
          <Card>
            <View style={styles.center}>
              <View style={styles.emptyIcon}>
                <Ionicons name="mic-outline" size={26} color={colors.green} />
              </View>
              <Text style={styles.emptyTitle}>Too short to draft a note</Text>
              <Text style={styles.loadSub}>
                Aurio needs a little more of the conversation for a reliable note. Try again,
                or record a longer consult next time.
              </Text>
              <PrimaryButton
                label="Try again"
                size="sm"
                style={styles.retry}
                icon={<Ionicons name="refresh" size={15} color={colors.white} />}
                onPress={() => void draftNote()}
              />
            </View>
          </Card>
        </Animated.View>
      ) : editing ? (
        <NoteEditor
          initial={note.markdown}
          saving={saving}
          onSave={saveEdit}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <Animated.View entering={revealNote}>
            <Card>
              <NoteMarkdown markdown={note.markdown} redFlags={note.redFlags} />
            </Card>
          </Animated.View>

          <View style={styles.editRow}>
            <PrimaryButton
              label="Edit note"
              variant="ghost"
              size="sm"
              icon={<Ionicons name="create-outline" size={15} color={colors.ink} />}
              onPress={() => setEditing(true)}
            />
          </View>

          <Animated.View entering={revealNotice}>
            <SafetyNotice>
              AI-drafted from this consult only. Review every line before signing. Not a diagnosis.
            </SafetyNotice>
          </Animated.View>
        </>
      )}
    </ConsultScreen>
  );
}

const styles = StyleSheet.create({
  chiprow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginBottom: space.xs },
  editRow: { alignItems: "flex-start", marginTop: space.xs },
  center: { alignItems: "center", gap: space.sm, paddingVertical: space.xl },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 999,
    backgroundColor: colors.greenSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.xs,
  },
  emptyTitle: { ...font.h3, color: colors.ink },
  loadTitle: { ...font.body, fontWeight: "600", color: colors.ink, marginTop: space.xs },
  loadSub: { ...font.bodySm, color: colors.ink3, textAlign: "center" },
  errTitle: { ...font.body, fontWeight: "600", color: colors.red },
  errBody: { ...font.bodySm, color: colors.ink2, textAlign: "center" },
  retry: { marginTop: space.sm },
});
