import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
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
import { getConsultDocuments } from "@/lib/db";
import { checkOrders } from "@/lib/meds/drugCheck";
import { DRUGS, INTERACTIONS } from "@/lib/meds/drugRules.data";
import { noteToSpeech } from "@/lib/tts/noteSpeech";
import { readAloud, stopReading } from "@/lib/tts/readAloud";
import { NOTE_MODEL_NAME } from "@/lib/pipeline/model";
import { normalizeModelMarkdown, stripThink } from "@/lib/pipeline/noteGen";
import { hardenStreamingMarkdown, noteIsEmpty } from "@/lib/pipeline/noteHighlight";
import { useConsultPipeline } from "@/lib/pipeline/PipelineProvider";
import { templateById } from "@/lib/pipeline/templates";
import { colors, font, space } from "@/lib/theme";

// Amber for a "moderate" medication flag (severe → red, info → ink3).
const MODERATE = colors.amber;

// Screen 4 of 6 — Consult note. The note is generated ON-DEVICE from the
// de-identified transcript, re-identified locally, and rendered as rich Markdown.
// The model never sees real identifiers; the re-ID map never leaves the device.
export default function NoteScreen() {
  const {
    consultId,
    redaction,
    note,
    noteStatus,
    noteError,
    draftNote,
    editNote,
    llmReady,
    llmProgress,
    noteStream,
    templateId,
  } = useConsultPipeline();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [docCount, setDocCount] = useState(0);

  // Attached Smart Scan documents (if any) — their de-identified text joined the
  // transcript for generation; the chip makes that provenance visible.
  useEffect(() => {
    if (!consultId) return;
    getConsultDocuments(consultId)
      .then((docs) => setDocCount(docs.length))
      .catch(() => setDocCount(0));
  }, [consultId]);

  // Stop any speech when leaving the screen or entering edit mode.
  useEffect(() => () => stopReading(), []);
  useEffect(() => {
    if (editing) {
      stopReading();
      setSpeaking(false);
    }
  }, [editing]);

  const toggleRead = () => {
    if (speaking) {
      stopReading();
      setSpeaking(false);
      return;
    }
    if (!note) return;
    readAloud(noteToSpeech(note.markdown), {
      onDone: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
    });
    setSpeaking(true);
  };

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

  // Inline medication-safety check over the note's orders (reference only).
  const drugFlags = useMemo(
    () => (note ? checkOrders(note.orders, DRUGS, INTERACTIONS) : []),
    [note],
  );

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
        {ready && note.generationMs > 0 ? (
          <Pill label={`${(note.generationMs / 1000).toFixed(1)}s · on-device`} variant="line" />
        ) : null}
        {docCount > 0 ? (
          <Pill label={`${docCount} document${docCount === 1 ? "" : "s"} attached`} variant="line" />
        ) : null}
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
              {llmReady && noteStream ? (
                // Live draft — the stream renders as FORMATTED markdown while the
                // model writes (streamdown pattern): think-tags stripped, model
                // punctuation folded, SOAP structure repaired, dangling marks
                // closed. The parsed + highlighted note replaces it on completion.
                <View style={styles.stream}>
                  <NoteMarkdown
                    streaming
                    markdown={hardenStreamingMarkdown(
                      normalizeModelMarkdown(
                        stripThink(noteStream).replace(/<think>[\s\S]*/, ""),
                      ),
                    )}
                  />
                </View>
              ) : null}
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

          {note.guidelines.length > 0 ? (
            <Animated.View entering={revealNotice} style={styles.guideRow}>
              <Ionicons name="sparkles" size={13} color={colors.green} />
              <Text style={styles.guideLabel}>Grounded in</Text>
              <View style={styles.guideChips}>
                {note.guidelines.map((g) => (
                  <Pill key={g.id} label={g.title} variant="line" />
                ))}
              </View>
            </Animated.View>
          ) : null}

          {drugFlags.length > 0 ? (
            <Animated.View entering={revealNotice}>
              <Card>
                <View style={styles.medHead}>
                  <Ionicons name="medkit-outline" size={15} color={colors.green} />
                  <Text style={styles.medTitle}>Medication safety</Text>
                </View>
                {drugFlags.map((f, i) => (
                  <View key={i} style={styles.medRow}>
                    <View
                      style={[
                        styles.medDot,
                        {
                          backgroundColor:
                            f.severity === "severe"
                              ? colors.red
                              : f.severity === "moderate"
                                ? MODERATE
                                : colors.ink3,
                        },
                      ]}
                    />
                    <View style={styles.medBody}>
                      <Text style={styles.medMsg}>{f.message}</Text>
                      {f.source ? <Text style={styles.medSrc}>{f.source}</Text> : null}
                    </View>
                  </View>
                ))}
                <Text style={styles.medNote}>Reference only — verify before prescribing.</Text>
              </Card>
            </Animated.View>
          ) : null}

          <View style={styles.editRow}>
            <PrimaryButton
              label="Edit note"
              variant="ghost"
              size="sm"
              icon={<Ionicons name="create-outline" size={15} color={colors.ink} />}
              onPress={() => setEditing(true)}
            />
            <PrimaryButton
              label={speaking ? "Stop" : "Read aloud"}
              variant="ghost"
              size="sm"
              icon={
                <Ionicons
                  name={speaking ? "stop" : "volume-high-outline"}
                  size={15}
                  color={colors.ink}
                />
              }
              onPress={toggleRead}
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
  editRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.xs },
  guideRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: space.xs },
  guideLabel: { ...font.label, color: colors.ink3, textTransform: "uppercase", marginRight: 2 },
  guideChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  medHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: space.xs },
  medTitle: { ...font.label, color: colors.green, textTransform: "uppercase" },
  medRow: { flexDirection: "row", gap: space.sm, alignItems: "flex-start", marginTop: 6 },
  medDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  medBody: { flex: 1 },
  medMsg: { ...font.body, color: colors.ink, lineHeight: 20 },
  medSrc: { ...font.bodySm, color: colors.ink3, marginTop: 1 },
  medNote: { ...font.bodySm, color: colors.ink3, fontStyle: "italic", marginTop: space.sm },
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
  stream: {
    opacity: 0.9,
    alignSelf: "stretch",
    marginTop: space.sm,
  },
  errTitle: { ...font.body, fontWeight: "600", color: colors.red },
  errBody: { ...font.bodySm, color: colors.ink2, textAlign: "center" },
  retry: { marginTop: space.sm },
});
