import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { ConsultScreen } from "@/components/consult/ConsultScreen";
import { startCapture, type CaptureController } from "@/lib/diarize";
import { haptic } from "@/lib/haptics";
import { getSttAccuracy, getSttLanguage } from "@/lib/pipeline/sttMode";
import { transcribeWaveform, whisperModelFor, whisperModelInfo } from "@/lib/pipeline/whisperStt";
import { colors, font, radius, space } from "@/lib/theme";

// Minimal STT test bench — record real speech, transcribe on-device with the bundled Malaysian
// Whisper, show the transcript + detected language + timing. For demos/prototyping the STT alone,
// without the full consult flow. Everything on-device; audio is discarded after transcription.

type Phase = "idle" | "recording" | "transcribing" | "done" | "error";

interface Result {
  text: string;
  language: string;
  seconds: number;
  ms: number;
}

export default function SttLabScreen() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const captureRef = useRef<CaptureController | null>(null);
  const startedAt = useRef(0);

  const start = async () => {
    haptic("recordStart");
    setErr(null);
    setResult(null);
    try {
      captureRef.current = await startCapture();
      setPhase("recording");
    } catch (e) {
      setErr(`Mic: ${String(e)}`);
      setPhase("error");
    }
  };

  const stop = async () => {
    const cap = captureRef.current;
    if (!cap) return;
    captureRef.current = null;
    haptic("tap");
    setPhase("transcribing");
    try {
      const waveform = await cap.stop();
      const t0 = Date.now();
      const tr = await transcribeWaveform(waveform, {
        model: whisperModelFor(getSttAccuracy()),
        language: getSttLanguage(),
      });
      setResult({
        text: tr.text || "(no speech)",
        language: tr.language || "?",
        seconds: Math.round((waveform.length / 16000) * 10) / 10,
        ms: Date.now() - t0,
      });
      setPhase("done");
    } catch (e) {
      setErr(String(e));
      setPhase("error");
    }
  };

  const recording = phase === "recording";
  const busy = phase === "transcribing";

  return (
    <ConsultScreen
      time="9:42"
      title="STT test"
      sub="Record → Malaysian Whisper transcribes on-device"
      onBack={() => router.back()}
    >
      <Card>
        <Text style={styles.meta}>
          {`Model: ${whisperModelInfo(getSttAccuracy()).name}\nLanguage: ${getSttLanguage()} · fully on-device`}
        </Text>
      </Card>

      <View style={styles.hero}>
        <Pressable
          onPress={recording ? stop : start}
          disabled={busy}
          style={[styles.mic, recording && styles.micRec, busy && styles.micBusy]}
        >
          <Ionicons
            name={busy ? "hourglass-outline" : recording ? "stop" : "mic"}
            size={40}
            color={colors.white}
          />
        </Pressable>
        <Text style={styles.hint}>
          {busy
            ? "Transcribing on-device…"
            : recording
              ? "Recording — tap to stop"
              : "Tap to record, speak Malay + English + 中文"}
        </Text>
      </View>

      {result ? (
        <Card>
          <Text style={styles.label}>TRANSCRIPT</Text>
          <Text style={styles.transcript} selectable>
            {result.text}
          </Text>
          <Text style={styles.stats}>
            {`${result.language} · ${result.seconds}s audio · ${result.ms}ms on-device`}
          </Text>
        </Card>
      ) : null}

      {err ? (
        <Card>
          <Text style={styles.label}>ERROR</Text>
          <Text style={styles.errText} selectable>
            {err}
          </Text>
        </Card>
      ) : null}
    </ConsultScreen>
  );
}

const styles = StyleSheet.create({
  meta: { ...font.bodySm, color: colors.ink2, lineHeight: 20 },
  hero: { alignItems: "center", gap: space.md, paddingVertical: space.xl },
  mic: {
    width: 96,
    height: 96,
    borderRadius: radius.pill,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  micRec: { backgroundColor: colors.red },
  micBusy: { backgroundColor: colors.ink3 },
  hint: { ...font.body, color: colors.ink3, textAlign: "center", paddingHorizontal: space.lg },
  label: { ...font.label, color: colors.ink3, textTransform: "uppercase", marginBottom: space.xs },
  transcript: { ...font.body, color: colors.ink, lineHeight: 24 },
  stats: {
    ...font.bodySm,
    color: colors.ink3,
    marginTop: space.sm,
    fontVariant: ["tabular-nums"],
  },
  errText: { ...font.bodySm, color: colors.red, lineHeight: 20 },
});
