import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useLLM } from "react-native-executorch";

import { Card } from "@/components/consult/Card";
import { ConsultScreen } from "@/components/consult/ConsultScreen";
import { haptic } from "@/lib/haptics";
import { NOTE_MODEL, NOTE_MODEL_NAME } from "@/lib/pipeline/model";
import {
  getSttAccuracy,
  getSttLanguage,
  setSttAccuracy,
} from "@/lib/pipeline/sttMode";
import { prewarmWhisper, whisperModelFor, whisperModelInfo } from "@/lib/pipeline/whisperStt";
import { colors, font, radius, space } from "@/lib/theme";

// "On-device AI" — the seamless model-prep screen. Aurio's moat model (Malaysian Whisper STT)
// ships BUNDLED in the app (offline, instant). The note LLM (Qwen) + optional Fast STT download
// once over Wi-Fi. This screen makes the footprint transparent and lets the clinician pre-warm
// the downloads before a consult, so first use is never a surprise wait. Everything stays on the
// device — nothing here uploads anything.

type DlState = { status: "idle" | "downloading" | "ready" | "error"; pct: number };

function Bar({ pct }: { pct: number }) {
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${Math.max(3, Math.round(pct * 100))}%` }]} />
    </View>
  );
}

/** Mounts useLLM on demand → triggers the Qwen download + surfaces progress. */
function NoteModelDownloader({ onDone }: { onDone: (ok: boolean) => void }) {
  const llm = useLLM({ model: NOTE_MODEL });
  useEffect(() => {
    if (llm.isReady) onDone(true);
    else if (llm.error) onDone(false);
  }, [llm.isReady, llm.error, onDone]);
  return (
    <View style={styles.progressRow}>
      <ActivityIndicator size="small" color={colors.greenInk} />
      <Text style={styles.progressText}>
        {`Downloading ${NOTE_MODEL_NAME}… ${Math.round((llm.downloadProgress ?? 0) * 100)}%`}
      </Text>
    </View>
  );
}

export default function AiModelsScreen() {
  // Note LLM (Qwen) — download gated behind a tap (mounts the downloader only then).
  const [note, setNote] = useState<DlState>({ status: "idle", pct: 0 });
  const [noteDownloading, setNoteDownloading] = useState(false);

  // Fast STT tier (optional generic multilingual base) — prewarm via whisper.rn.
  const [fast, setFast] = useState<DlState>({ status: "idle", pct: 0 });

  const downloadHigh = async () => {
    haptic("tap");
    setFast({ status: "downloading", pct: 0 });
    try {
      await prewarmWhisper(whisperModelFor("high"), (p) => setFast({ status: "downloading", pct: p }));
      setFast({ status: "ready", pct: 1 });
    } catch {
      setFast({ status: "error", pct: 0 });
    }
  };

  return (
    <ConsultScreen
      time="9:42"
      title="On-device AI"
      sub="Every model runs on this phone — nothing leaves the device"
      onBack={() => router.back()}
    >
      {/* STT — best-accuracy tier downloads once; the bundled Malaysian model is the offline fallback. */}
      <Card>
        <View style={styles.head}>
          <View style={[styles.iconWrap, styles.iconReady]}>
            <Ionicons name="mic" size={18} color={colors.white} />
          </View>
          <View style={styles.headText}>
            <Text style={styles.name}>Speech-to-text</Text>
            <Text style={styles.role}>{`${whisperModelInfo(getSttAccuracy()).name} · Malay + English + 中文`}</Text>
          </View>
        </View>
        <View style={styles.statusReady}>
          <Ionicons name="checkmark-circle" size={16} color={colors.greenInk} />
          <Text style={styles.statusReadyText}>
            {getSttAccuracy() === "high"
              ? "Best accuracy · 547MB one-time download (below)"
              : "Bundled in app · ready offline · 181MB"}
          </Text>
        </View>
        <Text style={styles.note}>
          {`Language: ${getSttLanguage() === "ms" ? "Bahasa Melayu" : getSttLanguage() === "en" ? "English" : "Auto-detect (recommended)"} · change in Settings → Transcription`}
        </Text>
      </Card>

      {/* Note LLM — one-time download over Wi-Fi. */}
      <Card>
        <View style={styles.head}>
          <View style={styles.iconWrap}>
            <Ionicons name="document-text-outline" size={18} color={colors.green} />
          </View>
          <View style={styles.headText}>
            <Text style={styles.name}>Note AI</Text>
            <Text style={styles.role}>{NOTE_MODEL_NAME} · writes the SOAP note + cleans the transcript</Text>
          </View>
        </View>
        {note.status === "ready" ? (
          <View style={styles.statusReady}>
            <Ionicons name="checkmark-circle" size={16} color={colors.greenInk} />
            <Text style={styles.statusReadyText}>Ready on-device</Text>
          </View>
        ) : noteDownloading ? (
          <NoteModelDownloader
            onDone={(ok) => {
              setNoteDownloading(false);
              setNote({ status: ok ? "ready" : "error", pct: ok ? 1 : 0 });
            }}
          />
        ) : (
          <Pressable
            style={styles.action}
            onPress={() => {
              haptic("tap");
              setNoteDownloading(true);
              setNote({ status: "downloading", pct: 0 });
            }}
          >
            <Ionicons
              name={note.status === "error" ? "refresh-outline" : "cloud-download-outline"}
              size={18}
              color={colors.ink2}
            />
            <Text style={styles.actionText}>
              {note.status === "error" ? "Download failed — tap to retry" : "Download over Wi-Fi · ~1.1GB, one-time"}
            </Text>
          </Pressable>
        )}
        <Text style={styles.note}>Otherwise it downloads automatically on your first consult.</Text>
      </Card>

      {/* Optional Fast STT tier. */}
      <Card>
        <View style={styles.head}>
          <View style={styles.iconWrap}>
            <Ionicons name="sparkles-outline" size={18} color={colors.green} />
          </View>
          <View style={styles.headText}>
            <Text style={styles.name}>Best-accuracy speech-to-text</Text>
            <Text style={styles.role}>{`${whisperModelInfo("high").name} · best for Malaysian code-switch`}</Text>
          </View>
        </View>
        {fast.status === "ready" ? (
          <View style={styles.statusReady}>
            <Ionicons name="checkmark-circle" size={16} color={colors.greenInk} />
            <Text style={styles.statusReadyText}>Ready on-device</Text>
          </View>
        ) : fast.status === "downloading" ? (
          <>
            <View style={styles.progressRow}>
              <ActivityIndicator size="small" color={colors.greenInk} />
              <Text style={styles.progressText}>{`Downloading… ${Math.round(fast.pct * 100)}%`}</Text>
            </View>
            <Bar pct={fast.pct} />
          </>
        ) : (
          <Pressable style={styles.action} onPress={downloadHigh}>
            <Ionicons
              name={fast.status === "error" ? "refresh-outline" : "cloud-download-outline"}
              size={18}
              color={colors.ink2}
            />
            <Text style={styles.actionText}>
              {fast.status === "error" ? "Download failed — tap to retry" : `Download & prepare · ${whisperModelInfo("high").size}`}
            </Text>
          </Pressable>
        )}
      </Card>

      <Text style={styles.footer}>
        Total footprint under ~1GB. Models are cached once and reused. Raw audio is never stored or
        uploaded — only de-identified text may ever cross the boundary, and only on the optional
        cloud path.
      </Text>
    </ConsultScreen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.greenSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  iconReady: { backgroundColor: colors.green },
  headText: { flex: 1, minWidth: 0 },
  name: { ...font.body, fontWeight: "600", color: colors.ink },
  role: { ...font.bodySm, color: colors.ink3, marginTop: 1 },
  statusReady: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: space.md,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    borderCurve: "continuous",
    backgroundColor: colors.green50,
  },
  statusReadyText: { ...font.bodySm, color: colors.greenInk, fontWeight: "600" },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: space.md,
    padding: space.sm,
    borderRadius: radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  actionText: { ...font.bodySm, color: colors.ink2, flexShrink: 1 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: space.md },
  progressText: { ...font.bodySm, color: colors.ink2 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: "hidden", marginTop: space.sm },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.greenInk },
  note: { ...font.bodySm, color: colors.ink3, marginTop: space.sm },
  footer: {
    ...font.bodySm,
    color: colors.ink3,
    textAlign: "center",
    marginTop: space.md,
    paddingHorizontal: space.sm,
    lineHeight: 18,
  },
});
