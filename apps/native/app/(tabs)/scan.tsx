import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, type Href } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown, useReducedMotion } from "react-native-reanimated";

import { Card } from "@/components/consult/Card";
import { Pill } from "@/components/consult/Pill";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { CardHeading } from "@/components/consult/SectionLabel";
import { SwipeableRow } from "@/components/consult/SwipeableRow";
import { TabScaffold } from "@/components/consult/TabScaffold";
import { haptic } from "@/lib/haptics";
import {
  createScannedDocument,
  deleteScannedDocument,
  listScannedDocuments,
  renameScannedDocument,
  type ScannedDocumentListItem,
} from "@/lib/db";
import type { ScannedDocument } from "@/lib/db/types";
import * as ImagePicker from "expo-image-picker";

import { Asset } from "expo-asset";

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

// One-line content preview so a generically-titled card ("Document") is still
// identifiable: the AI note's title when one exists, else the first line of the
// extracted text (device-only display — same PHI posture as the consult snippet).
function docPreview(d: ScannedDocument): string {
  const t = d.summary?.match(/^\*\*(.+?)\*\*/)?.[1]?.trim();
  if (t) return t;
  return d.rawText.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
}

function timeAgo(ts: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function SmartScanScreen() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState("");
  const [docs, setDocs] = useState<ScannedDocumentListItem[]>([]);

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
  // the record; a PHI image in the sandbox has no further use. "sample" runs the
  // bundled synthetic referral letter through the SAME real pipeline (demo aid — no
  // printed prop or lighting needed; the asset is app-bundled, not a user photo, so
  // the destroy step skips it).
  const capture = async (source: "scanner" | "library" | "sample") => {
    setErr("");
    haptic("tap");
    setPhase("scanning");
    let uris: string[] = [];
    try {
      uris =
        source === "scanner"
          ? await scanDocumentPages()
          : source === "library"
            ? await oneFromLibrary()
            : await sampleLetterUri();
    } catch {
      uris = [];
    }
    if (uris.length === 0) {
      setErr(source === "sample" ? "Sample unavailable." : await permissionHint(source));
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
      // The bundled sample is an app asset, not a captured PHI image — keep its
      // cached copy so the button works offline next time.
      if (source !== "sample") deletePageImages(uris);
    }
  };

  // Rename / delete for a scan card — same interactions as consult rows (swipe
  // actions + long-press rename). Delete keeps its confirm: it wipes the extracted
  // text and summary too.
  const renameDoc = useCallback(
    (d: ScannedDocument) => {
      if (process.env.EXPO_OS !== "ios") return;
      Alert.prompt(
        "Rename document",
        "A short, PII-free label.",
        (text) => {
          const t = text?.trim();
          if (t) void renameScannedDocument(d.id, t).then(reload);
        },
        "plain-text",
        d.title,
      );
    },
    [reload],
  );
  const removeDoc = useCallback(
    (d: ScannedDocument) => {
      Alert.alert(
        "Delete scan?",
        `"${d.title}" and its extracted text will be permanently removed from this device.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => void deleteScannedDocument(d.id).then(reload),
          },
        ],
      );
    },
    [reload],
  );

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
          // Keyed fades so busy ↔ actions crossfade instead of snapping.
          <Animated.View key="busy" entering={FadeIn.duration(220)} style={styles.busyRow}>
            <ActivityIndicator color={colors.green} />
            <Text style={styles.busyText}>
              {phase === "scanning" ? "Scanner open…" : progress || "Reading on-device…"}
            </Text>
          </Animated.View>
        ) : (
          <Animated.View key="actions" entering={FadeIn.duration(220)} style={styles.actions}>
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
          </Animated.View>
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
        docs.map((d, i) => (
          // Recent scans cascade in like the consult list (30ms stagger, capped).
          <Animated.View
            key={d.id}
            entering={
              reduce
                ? FadeIn.duration(200)
                : FadeInDown.delay(Math.min(i, 8) * 30).duration(300)
            }
          >
          <SwipeableRow
            actions={[
              { label: "Rename", icon: "pencil", color: colors.ink3, onPress: () => renameDoc(d) },
              { label: "Delete", icon: "trash", color: colors.red, onPress: () => removeDoc(d) },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({ pathname: "/scan-review", params: { docId: d.id } } as Href)
              }
              onLongPress={() => renameDoc(d)}
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
                        {`${timeAgo(d.createdAt)} · ${d.pages} page${d.pages === 1 ? "" : "s"} · ${d.identifiers} identifier${d.identifiers === 1 ? "" : "s"} redacted`}
                      </Text>
                      {docPreview(d) ? (
                        <Text style={styles.rowSnippet} numberOfLines={1}>
                          {docPreview(d)}
                        </Text>
                      ) : null}
                      {d.status === "attached" && d.attachedTo ? (
                        <View style={styles.attachedRow}>
                          <Ionicons name="person-outline" size={11} color={colors.greenDeep} />
                          <Text style={styles.attachedText} numberOfLines={1}>
                            {d.attachedTo}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    {d.status === "attached" ? (
                      <Pill label="In consult" variant="green" />
                    ) : d.summary ? (
                      <Pill label="Noted" variant="green" />
                    ) : (
                      <Pill label="Text only" variant="line" />
                    )}
                    <Ionicons name="chevron-forward" size={16} color={colors.ink3} />
                  </View>
                </Card>
              )}
            </Pressable>
          </SwipeableRow>
          </Animated.View>
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

// Bundled synthetic referral letter (fictional patient/clinic) — resolves to a
// local file URI the OCR engines can read. Works fully offline.
async function sampleLetterUri(): Promise<string[]> {
  const asset = Asset.fromModule(require("../../assets/demo/sample-referral.png"));
  await asset.downloadAsync();
  return asset.localUri ? [asset.localUri] : [];
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
  rowSnippet: { ...font.bodySm, color: colors.ink2, marginTop: 2, fontStyle: "italic" },
  attachedRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 3 },
  attachedText: { fontSize: 11, fontWeight: "600", color: colors.greenDeep, flexShrink: 1 },
  footer: {
    ...font.bodySm,
    color: colors.ink3,
    textAlign: "center",
    marginTop: space.sm,
    paddingHorizontal: space.md,
    lineHeight: 18,
  },
});
