import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams, type Href } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { ConsultScreen } from "@/components/consult/ConsultScreen";
import { NoteEditor } from "@/components/consult/NoteEditor";
import { NoteMarkdown } from "@/components/consult/NoteMarkdown";
import { Pill } from "@/components/consult/Pill";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { CardHeading } from "@/components/consult/SectionLabel";
import { haptic } from "@/lib/haptics";
import {
  getScannedDocument,
  setScannedDocumentSummary,
  updateScannedDocumentText,
} from "@/lib/db";
import type { ScannedDocument } from "@/lib/db/types";
import { generateDocSummary } from "@/lib/vision/docSummary";
import { redactDocText } from "@/lib/vision/ocr";
import { colors, font, space } from "@/lib/theme";

// Smart Scan review — the human gate between OCR and any AI use (same pattern as the
// consult "Review & label" screen). The clinician reads and corrects the extracted text,
// then either abstracts it into a structured document note (on-device Qwen, editable
// like the consult note) or attaches it to a consult via the full-screen picker
// (/scan-attach) so its de-identified text informs that consult's note.

type SummaryPhase = "idle" | "loading-model" | "generating" | "done" | "error";

export default function ScanReviewScreen() {
  const { docId } = useLocalSearchParams<{ docId: string }>();
  const [doc, setDoc] = useState<ScannedDocument | null>(null);
  const [text, setText] = useState("");
  const [identifiers, setIdentifiers] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [summaryPhase, setSummaryPhase] = useState<SummaryPhase>("idle");
  const [modelPct, setModelPct] = useState(0);
  const [summary, setSummary] = useState<string | null>(null);
  const [editingSummary, setEditingSummary] = useState(false);
  const [savingSummary, setSavingSummary] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!docId) return;
    getScannedDocument(docId)
      .then((d) => {
        if (!d) return;
        setDoc(d);
        setText(d.rawText);
        setIdentifiers(d.identifiers);
        setSummary(d.summary);
        if (d.summary) setSummaryPhase("done");
      })
      .catch(() => setDoc(null));
  }, [docId]);

  // Refresh attach state when returning from the full-screen picker (/scan-attach) —
  // status/consultId may have changed there. The clinician's in-progress TEXT edits are
  // deliberately left untouched.
  useFocusEffect(
    useCallback(() => {
      if (!docId) return;
      getScannedDocument(docId)
        .then((d) => {
          if (!d) return;
          setDoc((prev) => (prev ? { ...prev, status: d.status, consultId: d.consultId } : d));
        })
        .catch(() => {});
    }, [docId]),
  );

  // Persist clinician corrections (debounced): re-redact the edited text so the
  // de-identified form — the only form any AI sees — always matches what's on screen.
  const persistText = useCallback(
    (next: string) => {
      if (!doc) return;
      const { redacted, identifiers: count } = redactDocText(next);
      setIdentifiers(count);
      void updateScannedDocumentText(doc.id, next, redacted, count).catch(() => {});
    },
    [doc],
  );
  const latestText = useRef<{ value: string; pending: boolean }>({ value: "", pending: false });
  const persistRef = useRef(persistText);
  persistRef.current = persistText;
  const onEdit = (next: string) => {
    setText(next);
    setDirty(true);
    latestText.current = { value: next, pending: true };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      latestText.current.pending = false;
      persistText(next);
    }, 600);
  };
  // FLUSH on unmount — a correction made <600ms before tapping back must still be
  // persisted, or a later note would be generated from text the clinician fixed.
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (latestText.current.pending) persistRef.current(latestText.current.value);
    },
    [],
  );

  // "Create document note" — abstract the verified, DE-IDENTIFIED text on-device.
  const makeSummary = async () => {
    if (!doc) return;
    haptic("tap");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    persistText(text); // summary must run over the latest correction
    setSummaryPhase("loading-model");
    setModelPct(0);
    try {
      const { redacted } = redactDocText(text);
      // onProgress fires ONLY for a fresh download (never when cached) — phase must
      // come from onLoaded, or a cached model shows "Loading note AI…" forever.
      const res = await generateDocSummary(
        redacted,
        doc.title,
        (p) => setModelPct(p),
        () => setSummaryPhase("generating"),
      );
      // Title rides inside the persisted markdown (bold first line) so a reopened
      // doc renders identically from the single summary column.
      const summaryMd = `**${res.title}**\n\n${res.markdown}`;
      setSummary(summaryMd);
      setSummaryPhase("done");
      setDirty(false);
      haptic("noteReady");
      // An attached doc STAYS attached — summarizing must not flip it back to
      // "saved" (that re-enabled Attach and let the doc move between consults).
      const keepStatus = doc.status === "attached" ? "attached" : "saved";
      await setScannedDocumentSummary(doc.id, summaryMd, keepStatus);
      setDoc((d) => (d ? { ...d, summary: summaryMd, status: keepStatus } : d));
    } catch {
      setSummaryPhase("error");
    }
  };

  // "Attach to consult" — full-screen scrollable picker (/scan-attach). Flush any
  // pending text edit first so the attached consult sees the corrected redaction.
  const openAttach = () => {
    if (!doc) return;
    haptic("tap");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    persistText(text);
    router.push({ pathname: "/scan-attach", params: { docId: doc.id } } as Href);
  };

  // Clinician edit of the generated document note — same editor as the consult note.
  // The edited Markdown becomes the stored summary; attach state is preserved.
  const saveSummaryEdit = async (edited: string) => {
    if (!doc) return;
    setSavingSummary(true);
    try {
      const keepStatus = doc.status === "attached" ? "attached" : "saved";
      await setScannedDocumentSummary(doc.id, edited, keepStatus);
      setSummary(edited);
      setDoc((d) => (d ? { ...d, summary: edited, status: keepStatus } : d));
      setEditingSummary(false);
    } finally {
      setSavingSummary(false);
    }
  };

  if (!doc) {
    return (
      <ConsultScreen title="Review scan" onBack={() => router.back()}>
        <Card>
          <Text style={styles.body}>Document not found.</Text>
        </Card>
      </ConsultScreen>
    );
  }

  const generating = summaryPhase === "loading-model" || summaryPhase === "generating";

  return (
    <ConsultScreen
      title="Review scan"
      sub="Check the extracted text before any AI uses it"
      // Back is disabled mid-generation: leaving would let a recording start while
      // this screen's Qwen instance is still loaded (whisper starvation, double-load).
      onBack={generating ? undefined : () => router.back()}
      right={<Pill label="On-device" variant="green" dot />}
      footer={
        // Stacked full-width CTAs: two long labels side-by-side wrapped to two lines
        // (ugly, unbalanced). Primary action on top, quiet secondary under it. Hidden
        // while the summary editor is open — its own Save/Cancel owns the screen.
        editingSummary ? undefined : (
          <View style={styles.footerCol}>
            <PrimaryButton
              label={
                summary && !dirty
                  ? "Regenerate document note"
                  : summaryPhase === "error"
                    ? "Retry document note"
                    : "Create document note"
              }
              onPress={makeSummary}
              disabled={generating}
              icon={<Ionicons name="sparkles" size={16} color={colors.white} />}
            />
            <PrimaryButton
              label={doc.status === "attached" ? "Attached to consult" : "Attach to consult"}
              variant="ghost"
              onPress={openAttach}
              disabled={generating || doc.status === "attached"}
              icon={
                <Ionicons
                  name={doc.status === "attached" ? "checkmark-circle" : "folder-open-outline"}
                  size={16}
                  color={doc.status === "attached" ? colors.greenInk : colors.ink}
                />
              }
            />
          </View>
        )
      }
    >
      <Card>
        <View style={styles.metaRow}>
          <Pill label={doc.title} variant="line" />
          <Pill
            label={`${identifiers} identifier${identifiers === 1 ? "" : "s"} redacted`}
            variant={identifiers > 0 ? "green" : "line"}
          />
          {doc.status === "attached" ? <Pill label="In consult" variant="green" /> : null}
        </View>
        <Text style={styles.hint}>Tap the text to correct anything the scanner misread.</Text>
        <TextInput
          value={text}
          onChangeText={onEdit}
          multiline
          scrollEnabled={false}
          style={styles.editor}
          textAlignVertical="top"
        />
      </Card>

      {generating ? (
        <Card variant="green">
          <View style={styles.busyRow}>
            <ActivityIndicator color={colors.greenInk} />
            <Text style={styles.busyText}>
              {summaryPhase === "loading-model"
                ? modelPct > 0 && modelPct < 1
                  ? `Downloading note AI… ${Math.round(modelPct * 100)}% (one-time)`
                  : "Loading note AI…"
                : "Abstracting on-device…"}
            </Text>
          </View>
        </Card>
      ) : null}

      {summaryPhase === "error" ? (
        <Card variant="amber">
          <Text style={styles.body}>
            The note AI isn't available right now — the verified text above is saved and can
            still be attached to a consult. Tap “Retry document note” to try again.
          </Text>
        </Card>
      ) : null}

      {summary && summaryPhase === "done" ? (
        editingSummary ? (
          <NoteEditor
            initial={summary}
            saving={savingSummary}
            onSave={(md) => void saveSummaryEdit(md)}
            onCancel={() => setEditingSummary(false)}
          />
        ) : (
          <Card variant="green">
            <View style={styles.summaryHead}>
              <CardHeading>{`Document note · on-device`}</CardHeading>
              <PrimaryButton
                label="Edit"
                variant="ghost"
                size="sm"
                onPress={() => {
                  haptic("tap");
                  setEditingSummary(true);
                }}
                icon={<Ionicons name="pencil" size={14} color={colors.ink} />}
              />
            </View>
            <NoteMarkdown markdown={summary} />
            <Text style={styles.note}>
              Generated from the de-identified text only. Review before relying on it.
            </Text>
          </Card>
        )
      ) : null}
    </ConsultScreen>
  );
}

const styles = StyleSheet.create({
  body: { ...font.body, color: colors.ink2, lineHeight: 20 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  hint: { ...font.bodySm, color: colors.ink3, marginTop: space.sm },
  editor: {
    ...font.body,
    color: colors.ink,
    lineHeight: 21,
    marginTop: space.sm,
    minHeight: 160,
    padding: 0,
  },
  busyRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  busyText: { ...font.body, color: colors.greenInk },
  note: { ...font.bodySm, color: colors.greenInk, marginTop: space.sm },
  footerCol: { gap: space.sm },
  summaryHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
});
