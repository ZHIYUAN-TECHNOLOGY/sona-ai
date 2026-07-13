import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, type Href } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { Pill } from "@/components/consult/Pill";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { CardHeading } from "@/components/consult/SectionLabel";
import { TabScaffold } from "@/components/consult/TabScaffold";
import { haptic } from "@/lib/haptics";
import { createScannedDocument, listScannedDocuments } from "@/lib/db";
import type { ScannedDocument } from "@/lib/db/types";
import * as ImagePicker from "expo-image-picker";

import { classifyDocType } from "@/lib/vision/docType";
import { extractPages, joinPages, redactDocText } from "@/lib/vision/ocr";
import { pickFromLibrary } from "@/lib/vision/pickImage";
import { deletePageImages, scanDocumentPages } from "@/lib/vision/scanner";
import { colors, font, radius, space } from "@/lib/theme";

// Tab 3 — Smart Scan. Scan paper documents (referral letters, lab results,
// prescriptions) with the native document scanner, read them on-device (ML Kit OCR,
// no download), de-identify with the consult redactor, then either abstract them into
// a structured document note or attach them to a consult so they inform its note —
// the Heidi-style "upload files → build notes" flow, 100% on the phone.

type ScanPhase = "idle" | "scanning" | "reading";

const TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  referral: "mail-outline",
  "lab-result": "flask-outline",
  prescription: "medkit-outline",
  discharge: "exit-outline",
  other: "document-outline",
};

function timeAgo(ts: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function SmartScanScreen() {
  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState("");
  const [docs, setDocs] = useState<ScannedDocument[]>([]);

  const reload = useCallback(() => {
    listScannedDocuments()
      .then(setDocs)
      .catch(() => setDocs([]));
  }, []);
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  // A capture finishing after the tab lost focus must not yank the user back here.
  const focused = useRef(true);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
      };
    }, []),
  );

  // Empty result = cancel OR permission denial (the APIs can't distinguish). Check the
  // permission so a denied camera doesn't read as a silent dead button.
  const permissionHint = async (source: "scanner" | "library"): Promise<string> => {
    try {
      const perm =
        source === "scanner"
          ? await ImagePicker.getCameraPermissionsAsync()
          : await ImagePicker.getMediaLibraryPermissionsAsync();
      if (!perm.granted && !perm.canAskAgain) {
        return source === "scanner"
          ? "Camera access is off — enable it in Settings → Aurio → Camera."
          : "Photos access is off — enable it in Settings → Aurio → Photos.";
      }
    } catch {
      // permission API unavailable — stay silent, same as a plain cancel
    }
    return "";
  };

  // Scan (or pick) → OCR each page → de-identify → persist → review screen. The page
  // images are DESTROYED the moment OCR finishes (every path): the verified text is
  // the record; a PHI image in the sandbox has no further use.
  const capture = async (source: "scanner" | "library") => {
    setErr("");
    haptic("tap");
    setPhase("scanning");
    let uris: string[] = [];
    try {
      uris = source === "scanner" ? await scanDocumentPages() : await oneFromLibrary();
    } catch {
      uris = [];
    }
    if (uris.length === 0) {
      setErr(await permissionHint(source));
      setPhase("idle");
      return;
    }
    setPhase("reading");
    try {
      const pageTexts = await extractPages(uris, (p, total) =>
        setProgress(total > 1 ? `Reading page ${p} of ${total}…` : "Reading on-device…"),
      );
      const raw = joinPages(pageTexts);
      if (!raw.trim()) {
        setErr("No text detected — try better lighting or hold the phone steadier.");
        setPhase("idle");
        return;
      }
      const { redacted, identifiers } = redactDocText(raw);
      const kind = classifyDocType(raw);
      const doc = await createScannedDocument({
        docType: kind.type,
        title: uris.length > 1 ? `${kind.label} · ${uris.length} pages` : kind.label,
        pages: uris.length,
        imageUris: [], // images are destroyed below, never persisted
        rawText: raw,
        redactedText: redacted,
        identifiers,
      });
      haptic("select");
      setPhase("idle");
      reload();
      if (focused.current) {
        router.push({ pathname: "/scan-review", params: { docId: doc.id } } as Href);
      }
    } catch (e) {
      setErr(`Couldn't read the document: ${e instanceof Error ? e.message : String(e)}`);
      setPhase("idle");
    } finally {
      deletePageImages(uris);
    }
  };

  const busy = phase !== "idle";

  return (
    <TabScaffold title="Smart Scan" onRefresh={reload}>
      <Card variant="green">
        <CardHeading>Scan a document</CardHeading>
        <Text style={styles.body}>
          Referral letter, lab result, prescription — scanned and read fully on this phone.
          The image and text never leave the device.
        </Text>
        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator color={colors.green} />
            <Text style={styles.busyText}>
              {phase === "scanning" ? "Scanner open…" : progress || "Reading on-device…"}
            </Text>
          </View>
        ) : (
          <View style={styles.actions}>
            <PrimaryButton
              label="Scan document"
              onPress={() => capture("scanner")}
              icon={<Ionicons name="scan-outline" size={18} color={colors.white} />}
              style={styles.grow}
            />
            <PrimaryButton
              label="From photos"
              variant="ghost"
              onPress={() => capture("library")}
              icon={<Ionicons name="image-outline" size={18} color={colors.ink} />}
              style={styles.grow}
            />
          </View>
        )}
        {err ? (
          <Text style={styles.err} selectable>
            {err}
          </Text>
        ) : null}
      </Card>

      <View style={styles.listHead}>
        <CardHeading>Recent scans</CardHeading>
      </View>
      {docs.length === 0 ? (
        <Card>
          <View style={styles.empty}>
            <Ionicons name="scan-outline" size={26} color={colors.ink3} />
            <Text style={styles.emptyTitle}>Nothing scanned yet</Text>
            <Text style={styles.emptyBody}>
              Scans appear here — abstract them into a note or attach them to a consult.
            </Text>
          </View>
        </Card>
      ) : (
        docs.map((d) => (
          <Pressable
            key={d.id}
            accessibilityRole="button"
            onPress={() =>
              router.push({ pathname: "/scan-review", params: { docId: d.id } } as Href)
            }
          >
            {({ pressed }) => (
              <Card style={pressed ? styles.rowPressed : undefined}>
                <View style={styles.row}>
                  <View style={styles.rowIcon}>
                    <Ionicons
                      name={TYPE_ICON[d.docType] ?? "document-outline"}
                      size={18}
                      color={colors.green}
                    />
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {d.title}
                    </Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {`${timeAgo(d.createdAt)} · ${d.identifiers} identifier${d.identifiers === 1 ? "" : "s"} redacted`}
                    </Text>
                  </View>
                  {d.status === "attached" ? (
                    <Pill label="In consult" variant="green" />
                  ) : d.summary ? (
                    <Pill label="Summarized" variant="line" />
                  ) : null}
                  <Ionicons name="chevron-forward" size={16} color={colors.ink3} />
                </View>
              </Card>
            )}
          </Pressable>
        ))
      )}

      <Text style={styles.footer}>
        Scans are de-identified on-device with the same redactor as the consult transcript.
        Page images are destroyed the moment the text is extracted.
      </Text>
    </TabScaffold>
  );
}

// Library path stays single-image (the system picker has no document crop);
// normalized to the same string[] shape the scanner returns.
async function oneFromLibrary(): Promise<string[]> {
  const uri = await pickFromLibrary();
  return uri ? [uri] : [];
}

const styles = StyleSheet.create({
  body: { ...font.body, color: colors.greenInk, marginTop: space.xs, lineHeight: 20 },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.md },
  grow: { flex: 1 },
  busyRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.md },
  busyText: { ...font.body, color: colors.greenInk },
  err: { ...font.bodySm, color: colors.red, marginTop: space.sm },
  listHead: { marginTop: space.sm },
  empty: { alignItems: "center", gap: 6, paddingVertical: space.lg },
  emptyTitle: { ...font.body, fontWeight: "600", color: colors.ink2 },
  emptyBody: { ...font.bodySm, color: colors.ink3, textAlign: "center", paddingHorizontal: space.lg },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  rowPressed: { opacity: 0.7 },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.greenSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { ...font.body, fontWeight: "600", color: colors.ink },
  rowSub: { ...font.bodySm, color: colors.ink3, marginTop: 1 },
  footer: {
    ...font.bodySm,
    color: colors.ink3,
    textAlign: "center",
    marginTop: space.sm,
    paddingHorizontal: space.md,
    lineHeight: 18,
  },
});
