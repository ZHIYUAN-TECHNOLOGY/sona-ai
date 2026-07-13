import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { ConsultScreen } from "@/components/consult/ConsultScreen";
import { Pill } from "@/components/consult/Pill";
import { CardHeading } from "@/components/consult/SectionLabel";
import { haptic } from "@/lib/haptics";
import { getScannedDocument, listConsults } from "@/lib/db";
import type { Consult, ScannedDocument } from "@/lib/db/types";
import { attachDocumentToConsult } from "@/lib/pipeline/consultPipeline";
import { setPendingScanDoc } from "@/lib/pipeline/scanAttach";
import { colors, font, radius, space } from "@/lib/theme";

// Full-screen "Attach to consult" picker (replaced the bottom sheet — a sheet caps the
// visible list; a clinic day can have more open consults than a sheet holds). The whole
// page scrolls (ConsultScreen scaffold). Only PRE-NOTE consults are listed: attaching
// after the note exists would silently change nothing, and signed consults are sealed.
const ATTACHABLE = ["consented", "recording", "transcribed", "redacted"];

export default function ScanAttachScreen() {
  const { docId } = useLocalSearchParams<{ docId: string }>();
  const [doc, setDoc] = useState<ScannedDocument | null>(null);
  const [consults, setConsults] = useState<Consult[]>([]);
  const [err, setErr] = useState("");
  const [attaching, setAttaching] = useState(false);

  useEffect(() => {
    if (!docId) return;
    getScannedDocument(docId)
      .then(setDoc)
      .catch(() => setDoc(null));
    listConsults()
      .then((all) => setConsults(all.filter((c) => ATTACHABLE.includes(c.status))))
      .catch(() => setConsults([]));
  }, [docId]);

  const startNewConsult = () => {
    if (!doc) return;
    haptic("tap");
    // Park the doc; PipelineProvider.startConsult attaches it when the row exists.
    setPendingScanDoc(doc.id);
    router.push("/consent" as Href);
  };

  const attachTo = async (consult: Consult) => {
    if (!doc || attaching) return;
    setAttaching(true);
    setErr("");
    try {
      await attachDocumentToConsult(doc.id, consult.id);
      haptic("select");
      router.back(); // review screen reloads on focus and shows "Attached to consult"
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setAttaching(false);
    }
  };

  return (
    <ConsultScreen
      title="Attach to consult"
      sub={doc ? doc.title : "Scanned document"}
      onBack={() => router.back()}
      right={<Pill label="On-device" variant="green" dot />}
    >
      <Card variant="green">
        <Pressable
          accessibilityRole="button"
          onPress={startNewConsult}
          disabled={attaching}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <View style={[styles.icon, styles.iconPrimary]}>
            <Ionicons name="mic" size={18} color={colors.white} />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>New consult with this document</Text>
            <Text style={styles.rowSub}>Start recording — the document is already attached</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.greenInk} />
        </Pressable>
      </Card>

      {err ? (
        <Card variant="danger">
          <Text style={styles.err}>{err}</Text>
        </Card>
      ) : null}

      <View style={styles.listHead}>
        <CardHeading>Open consults</CardHeading>
        <Text style={styles.listNote}>
          Consults whose note is already drafted or signed can no longer take documents.
        </Text>
      </View>

      {consults.length === 0 ? (
        <Card>
          <View style={styles.empty}>
            <Ionicons name="folder-open-outline" size={26} color={colors.ink3} />
            <Text style={styles.emptyTitle}>No open consults</Text>
            <Text style={styles.emptyBody}>
              Start a new consult above — the document rides along automatically.
            </Text>
          </View>
        </Card>
      ) : (
        consults.map((c) => (
          <Pressable
            key={c.id}
            accessibilityRole="button"
            onPress={() => void attachTo(c)}
            disabled={attaching}
          >
            {({ pressed }) => (
              <Card style={pressed ? styles.pressed : undefined}>
                <View style={styles.row}>
                  <View style={styles.icon}>
                    <Ionicons name="folder-open-outline" size={18} color={colors.green} />
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {c.title}
                    </Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {new Date(c.createdAt).toLocaleString()}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.ink3} />
                </View>
              </Card>
            )}
          </Pressable>
        ))
      )}
    </ConsultScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  pressed: { opacity: 0.7 },
  icon: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.greenSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  iconPrimary: { backgroundColor: colors.green },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { ...font.body, fontWeight: "600", color: colors.ink },
  rowSub: { ...font.bodySm, color: colors.ink3, marginTop: 1 },
  listHead: { marginTop: space.sm, gap: 2 },
  listNote: { ...font.bodySm, color: colors.ink3 },
  empty: { alignItems: "center", gap: 6, paddingVertical: space.lg },
  emptyTitle: { ...font.body, fontWeight: "600", color: colors.ink2 },
  emptyBody: { ...font.bodySm, color: colors.ink3, textAlign: "center", paddingHorizontal: space.lg },
  err: { ...font.bodySm, color: colors.red },
});
