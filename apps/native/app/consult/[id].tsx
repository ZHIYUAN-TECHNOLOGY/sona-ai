import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { Card } from "@/components/consult/Card";
import { ConsultScreen } from "@/components/consult/ConsultScreen";
import { NoteEditor } from "@/components/consult/NoteEditor";
import { NoteMarkdown } from "@/components/consult/NoteMarkdown";
import { Pill } from "@/components/consult/Pill";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { consultFullSubtitle, consultHeadline, statusMeta } from "@/lib/consultFormat";
import { deleteConsult, getAudit, getConsult, getConsultDocuments, getNote } from "@/lib/db";
import type { AuditEntry, ClinicalNote, Consult, ScannedDocument } from "@/lib/db/types";
import { editClinicalNote } from "@/lib/pipeline/consultPipeline";
import { soapToMarkdown } from "@/lib/pipeline/noteFormat";
import { colors, font, radius, space } from "@/lib/theme";

// Consult detail — pushed over the tabs when a list row is tapped (native back).
// Reads everything from the on-device DB; renders the re-identified note (rebuilt
// from stored SOAP + orders). Draft consults show a "no note yet" state. Privacy &
// audit proves the moat. Nothing here leaves the device.
export default function ConsultDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [consult, setConsult] = useState<Consult | null>(null);
  const [note, setNote] = useState<ClinicalNote | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [docs, setDocs] = useState<ScannedDocument[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [c, n, a, d] = await Promise.all([
      getConsult(id),
      getNote(id),
      getAudit(id),
      getConsultDocuments(id).catch(() => [] as ScannedDocument[]),
    ]);
    setConsult(c);
    setNote(n);
    setAudit(a);
    setDocs(d);
    setLoaded(true);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        if (alive) await load();
      })();
      return () => {
        alive = false;
      };
    }, [load]),
  );

  const markdown = note ? soapToMarkdown(note.soap, note.orders) : "";

  const saveEdit = useCallback(
    async (edited: string) => {
      if (!consult) return;
      setSaving(true);
      try {
        await editClinicalNote(consult.id, edited);
        await load(); // re-read the persisted, re-parsed note
        setEditing(false);
      } finally {
        setSaving(false);
      }
    },
    [consult, load],
  );

  const remove = useCallback(() => {
    if (!consult) return;
    Alert.alert("Delete consult?", `"${consult.title}" and its note will be permanently removed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void deleteConsult(consult.id).then(() => router.back()),
      },
    ]);
  }, [consult]);

  const status = consult ? statusMeta(consult.status) : null;

  // Smart Scan documents attached to this consult — tap to reopen in the review
  // screen. Their de-identified text informed (or will inform) the note generation.
  const docIcon: Record<string, keyof typeof Ionicons.glyphMap> = {
    referral: "mail-outline",
    "lab-result": "flask-outline",
    prescription: "medkit-outline",
    discharge: "exit-outline",
  };
  const docsCard =
    docs.length > 0 ? (
      <Card>
        <View style={styles.docsHead}>
          <Ionicons name="scan-outline" size={16} color={colors.green} />
          <Text style={styles.docsTitle}>Attached documents</Text>
          <Pill label={`${docs.length}`} variant="line" />
        </View>
        {docs.map((d) => (
          <Pressable
            key={d.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: "/scan-review", params: { docId: d.id } })}
            style={({ pressed }) => [styles.docRow, pressed && styles.docPressed]}
          >
            <View style={styles.docIcon}>
              <Ionicons name={docIcon[d.docType] ?? "document-outline"} size={16} color={colors.green} />
            </View>
            <View style={styles.docText}>
              <Text style={styles.docTitle} numberOfLines={1}>
                {d.title}
              </Text>
              <Text style={styles.docSub} numberOfLines={1}>
                {`${d.identifiers} identifier${d.identifiers === 1 ? "" : "s"} redacted${d.summary ? " · summarized" : ""}`}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={15} color={colors.ink3} />
          </Pressable>
        ))}
        <Text style={styles.docsNote}>
          De-identified document text informs this consult’s note generation.
        </Text>
      </Card>
    ) : null;

  return (
    <ConsultScreen
      time=""
      title={consult ? consultHeadline(consult) : "Consult"}
      sub={consult ? consultFullSubtitle(consult) : "Loading…"}
      onBack={() => router.back()}
      right={status ? <Pill label={status.label} variant={status.variant} /> : undefined}
    >
      {!loaded ? (
        <Card>
          <View style={styles.center}>
            <ActivityIndicator color={colors.green} />
          </View>
        </Card>
      ) : note ? (
        <>
          {editing ? (
            <NoteEditor
              initial={markdown}
              saving={saving}
              onSave={saveEdit}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              <Animated.View entering={FadeIn.duration(240)}>
                <Card>
                  <NoteMarkdown markdown={markdown} redFlags={note.redFlags} />
                  {note.edited ? (
                    <View style={styles.editedRow}>
                      <Ionicons name="create-outline" size={12} color={colors.ink3} />
                      <Text style={styles.editedNote}>Edited by clinician</Text>
                    </View>
                  ) : null}
                </Card>
              </Animated.View>

              <View style={styles.actions}>
                <PrimaryButton
                  label="Edit"
                  variant="ghost"
                  style={styles.action}
                  icon={<Ionicons name="create-outline" size={17} color={colors.ink} />}
                  onPress={() => setEditing(true)}
                />
                <PrimaryButton
                  label="Delete"
                  variant="danger"
                  style={styles.action}
                  icon={<Ionicons name="trash-outline" size={17} color={colors.white} />}
                  onPress={remove}
                />
              </View>
            </>
          )}

          {docsCard}

          <Card variant="green">
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowAudit((s) => !s)}
              style={styles.auditHead}
            >
              <Ionicons name="shield-checkmark" size={18} color={colors.green} />
              <Text style={styles.auditTitle}>Privacy & audit</Text>
              <Ionicons
                name={showAudit ? "chevron-up" : "chevron-down"}
                size={16}
                color={colors.ink3}
              />
            </Pressable>
            <View style={styles.chiprow}>
              <Pill label="0 bytes to cloud" variant="green" />
              <Pill label="On-device" variant="line" />
            </View>
            {showAudit && (
              <Animated.View entering={FadeIn.duration(200)} style={styles.auditList}>
                {audit.length === 0 ? (
                  <Text style={styles.auditEmpty}>No audit entries.</Text>
                ) : (
                  audit.map((a) => (
                    <View key={a.id} style={styles.auditRow}>
                      <Text style={styles.auditStage}>{a.stage}</Text>
                      <Text style={styles.auditDetail} numberOfLines={2}>
                        {a.detail}
                      </Text>
                    </View>
                  ))
                )}
              </Animated.View>
            )}
          </Card>
        </>
      ) : (
        <>
          <Card>
            <View style={styles.center}>
              <View style={styles.emptyIcon}>
                <Ionicons name="document-outline" size={26} color={colors.ink3} />
              </View>
              <Text style={styles.emptyTitle}>No note yet</Text>
              <Text style={styles.emptyBody}>
                This consult was started but never produced a note. You can remove it.
              </Text>
              <PrimaryButton
                label="Delete consult"
                variant="danger"
                size="sm"
                style={styles.retry}
                icon={<Ionicons name="trash-outline" size={15} color={colors.white} />}
                onPress={remove}
              />
            </View>
          </Card>
          {docsCard}
        </>
      )}
    </ConsultScreen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", gap: space.sm, paddingVertical: space.xl },
  actions: { flexDirection: "row", gap: space.sm },
  action: { flex: 1 },
  editedRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: space.sm },
  editedNote: { ...font.bodySm, color: colors.ink3, fontStyle: "italic" },
  auditHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  auditTitle: { ...font.body, fontWeight: "600", color: colors.ink, flex: 1 },
  chiprow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: space.sm },
  auditList: { marginTop: space.md, gap: space.sm },
  auditRow: { gap: 1 },
  auditStage: { ...font.label, color: colors.green, textTransform: "uppercase" },
  auditDetail: { ...font.bodySm, color: colors.ink2 },
  auditEmpty: { ...font.bodySm, color: colors.ink3 },
  docsHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  docsTitle: { ...font.body, fontWeight: "600", color: colors.ink, flex: 1 },
  docRow: { flexDirection: "row", alignItems: "center", gap: space.md, marginTop: space.md },
  docPressed: { opacity: 0.6 },
  docIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.greenSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  docText: { flex: 1, minWidth: 0 },
  docTitle: { ...font.body, fontWeight: "600", color: colors.ink },
  docSub: { ...font.bodySm, color: colors.ink3, marginTop: 1 },
  docsNote: { ...font.bodySm, color: colors.ink3, marginTop: space.md },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.xs,
  },
  emptyTitle: { ...font.h3, color: colors.ink },
  emptyBody: { ...font.bodySm, color: colors.ink3, textAlign: "center", paddingHorizontal: space.md },
  retry: { marginTop: space.sm },
});
