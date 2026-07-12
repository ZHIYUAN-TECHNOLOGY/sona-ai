import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { CardHeading } from "@/components/consult/SectionLabel";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import {
  activeSpeakerEmbedderId,
  diarizeAudio,
  loadDoctorVoiceprint,
  startCapture,
  type CaptureController,
  type DiarizedSpeech,
} from "@/lib/diarize";
import { haptic } from "@/lib/haptics";
import type { RawSegment } from "@/lib/pipeline/mockStt";
import { alignTextToSpeakers, transcribeAudio } from "@/lib/pipeline/realStt";
import { colors, font, space } from "@/lib/theme";

type Phase = "idle" | "recording" | "analyzing" | "done" | "error";

const CHIP: Record<string, { label: string; color: string; bg: string; border: string }> = {
  doctor: { label: "DR", color: colors.greenInk, bg: colors.green50, border: colors.green100 },
  patient: { label: "PT", color: colors.blue, bg: colors.blue50, border: colors.blueLine },
  unknown: { label: "OTHER", color: colors.amber, bg: colors.amber50, border: colors.amberLine },
};

function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// Dev screen: exercises the REAL diarization path on-device — mic capture → FSMN-VAD →
// speaker embedding (active model) → clustering → role assignment. Reached from Settings.
// With the mock band-energy embedder the plumbing is real but separation is approximate;
// drop in a speaker .pte (REAL_MODEL.md) for accurate voice separation.
export default function DiarizationLab() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<DiarizedSpeech[]>([]);
  const [transcript, setTranscript] = useState<RawSegment[]>([]);
  const [sttNote, setSttNote] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState("");
  const capture = useRef<CaptureController | null>(null);
  const mounted = useRef(true);
  // Stop the recorder if the screen unmounts mid-capture — otherwise the mic stays hot.
  useEffect(
    () => () => {
      mounted.current = false;
      capture.current?.stop().catch(() => {});
      capture.current = null;
    },
    [],
  );

  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const modelId = activeSpeakerEmbedderId();
  const isMock = modelId.startsWith("mock");

  const start = async () => {
    setErr("");
    setResult([]);
    setTranscript([]);
    setSttNote("");
    setElapsed(0);
    haptic("recordStart");
    try {
      capture.current = await startCapture();
      if (mounted.current) setPhase("recording");
    } catch (e) {
      if (mounted.current) {
        setErr(String(e));
        setPhase("error");
      }
    }
  };

  const stop = async () => {
    if (!capture.current) return;
    setPhase("analyzing");
    haptic("recordStop");
    try {
      const waveform = await capture.current.stop();
      capture.current = null;
      const doctorVoiceprint = await loadDoctorVoiceprint();
      const diarized = await diarizeAudio(waveform, { doctorVoiceprint });
      if (!mounted.current) return;
      setResult(diarized);
      // Real STT: transcribe the same audio on-device (Whisper), then align the text to the
      // diarized speakers. Guarded — if the STT model isn't available, keep the diarization.
      try {
        const tr = await transcribeAudio(waveform);
        if (mounted.current) setTranscript(alignTextToSpeakers(tr.segments, diarized, tr.language));
      } catch {
        // Keep the diarization result; STT model may not be linked on this build.
        if (mounted.current) setSttNote("Transcription unavailable on this build (rebuild to link Whisper).");
      }
      if (mounted.current) setPhase("done");
    } catch (e) {
      if (mounted.current) {
        setErr(String(e));
        setPhase("error");
      }
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <Card>
          <CardHeading>What this does</CardHeading>
          <Text style={styles.body}>
            Records a few seconds through the mic, then runs the real on-device pipeline:
            Whisper transcription + voice-activity detection → speaker embedding → clustering
            → text aligned to doctor / patient / other. Nothing leaves the phone.
          </Text>
        </Card>

        <Card variant={isMock ? "amber" : "green"}>
          <View style={styles.row}>
            <Ionicons
              name={isMock ? "alert-circle-outline" : "checkmark-circle-outline"}
              size={20}
              color={isMock ? colors.amber : colors.green}
            />
            <Text style={[styles.note, { color: isMock ? colors.amber : colors.greenInk }]}>
              {isMock
                ? `Embedder: ${modelId} (mock). VAD + pipeline are real; separation is approximate — add a speaker .pte for accuracy.`
                : `Embedder: ${modelId} — real neural speaker model.`}
            </Text>
          </View>
        </Card>

        <Card>
          <CardHeading>Capture</CardHeading>
          {phase === "recording" ? (
            <View style={styles.recRow}>
              <View style={styles.dot} />
              <Text style={styles.recText}>Recording · {mmss(elapsed)} — speak as 2+ people</Text>
            </View>
          ) : phase === "analyzing" ? (
            <View style={styles.recRow}>
              <ActivityIndicator color={colors.green} />
              <Text style={styles.recText}>Transcribing + diarizing on-device…</Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            {phase === "recording" ? (
              <PrimaryButton label="Stop & analyze" onPress={stop} style={styles.grow} />
            ) : (
              <PrimaryButton
                label={phase === "analyzing" ? "Working…" : "Record"}
                onPress={start}
                disabled={phase === "analyzing"}
                icon={<Ionicons name="mic-outline" size={18} color={colors.white} />}
                style={styles.grow}
              />
            )}
          </View>
          {err ? (
            <Text style={styles.err} selectable>
              {err}
            </Text>
          ) : null}
        </Card>

        {phase === "done" && transcript.length > 0 ? (
          <Card>
            <CardHeading>Transcript · on-device</CardHeading>
            {transcript.map((r, i) => {
              const c = CHIP[r.speaker] ?? CHIP.unknown;
              return (
                <View key={i} style={styles.segRow}>
                  <View style={[styles.chip, { backgroundColor: c.bg, borderColor: c.border }]}>
                    <Text style={[styles.chipText, { color: c.color }]}>{c.label}</Text>
                  </View>
                  <Text style={styles.txt} selectable>
                    {r.text}
                  </Text>
                </View>
              );
            })}
          </Card>
        ) : phase === "done" && sttNote ? (
          <Card variant="amber">
            <Text style={styles.note} selectable>
              {sttNote}
            </Text>
          </Card>
        ) : null}

        {phase === "done" ? (
          <Card>
            <CardHeading>{`Speakers (${result.length} segments)`}</CardHeading>
            {result.length === 0 ? (
              <Text style={styles.body}>No speech detected. Try again and speak clearly.</Text>
            ) : (
              result.map((seg, i) => {
                const c = CHIP[seg.speaker] ?? CHIP.unknown;
                return (
                  <View key={i} style={styles.segRow}>
                    <View style={[styles.chip, { backgroundColor: c.bg, borderColor: c.border }]}>
                      <Text style={[styles.chipText, { color: c.color }]}>{c.label}</Text>
                    </View>
                    <Text style={styles.segTime}>
                      {mmss(seg.start)}–{mmss(seg.end)}
                    </Text>
                    <Text style={styles.segMeta}>
                      spk {seg.cluster} · {(seg.confidence * 100).toFixed(0)}%
                    </Text>
                  </View>
                );
              })
            )}
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  body: { ...font.body, color: colors.ink2, marginTop: space.xs },
  row: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  note: { ...font.bodySm, flex: 1, lineHeight: 19 },
  recRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs },
  recText: { ...font.body, color: colors.ink },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.red },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.lg },
  grow: { flex: 1 },
  err: { ...font.bodySm, color: colors.red, marginTop: space.sm },
  segRow: { flexDirection: "row", alignItems: "flex-start", gap: space.sm, marginTop: 10 },
  txt: { ...font.body, color: colors.ink, flex: 1, lineHeight: 20 },
  chip: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginTop: 1 },
  chipText: { fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },
  segTime: { ...font.body, color: colors.ink, fontVariant: ["tabular-nums"] },
  segMeta: { ...font.bodySm, color: colors.ink3, marginLeft: "auto", fontVariant: ["tabular-nums"] },
});
