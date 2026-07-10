import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { ConsultScreen } from "@/components/consult/ConsultScreen";
import { DiarRow } from "@/components/consult/DiarRow";
import type { SpeakerKey, TextSpan } from "@/components/consult/mockData";
import { consult } from "@/components/consult/mockData";
import { Pill } from "@/components/consult/Pill";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { RecordButton } from "@/components/consult/RecordButton";
import { SegmentedControl } from "@/components/consult/SegmentedControl";
import { Waveform } from "@/components/consult/Waveform";
import { useConsultPipeline } from "@/lib/pipeline/PipelineProvider";
import type { RawSegment } from "@/lib/pipeline/mockStt";
import { colors, font, space } from "@/lib/theme";

type Mode = "transcribe" | "dictate";

function toDiarRow(seg: RawSegment): { speaker: SpeakerKey; spans: TextSpan[]; faint: boolean } {
  const isDoctor = seg.speaker === "doctor";
  return { speaker: isDoctor ? "dr" : "pt", faint: isDoctor, spans: [{ text: seg.text, bm: seg.lang === "ms" }] };
}

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Screen 2 of 6 — Recording. Big circular record affordance (Heidi-inspired),
// segmented Transcribe/Dictate toggle, a live ticking timer, and the transcript
// peeking below. The note template is chosen upstream on the New-consult screen.
export default function RecordingScreen() {
  const { segments, startRecording } = useConsultPipeline();
  const started = useRef(false);
  const [mode, setMode] = useState<Mode>("transcribe");
  const [elapsed, setElapsed] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (started.current) return;
      started.current = true;
      startRecording();
    }, [startRecording]),
  );

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const peek = segments.slice(-3);
  const end = () => router.push("/privacy");

  return (
    <ConsultScreen
      time="9:42"
      title="Recording"
      sub={consult.patientLabel}
      right={<Pill label={consult.langBadge} variant="green" />}
      scroll={false}
      footer={<PrimaryButton label="End consult" onPress={end} />}
    >
      <View style={styles.top}>
        <SegmentedControl<Mode>
          options={[
            { key: "transcribe", label: "Transcribe" },
            { key: "dictate", label: "Dictate" },
          ]}
          value={mode}
          onChange={setMode}
        />
      </View>

      <View style={styles.hero}>
        <RecordButton recording onPress={end} accessibilityLabel="End consult" />
        <Text style={styles.timer}>{mmss(elapsed)}</Text>
        <View style={styles.waveWrap}>
          <Waveform live />
        </View>
        <Text style={styles.caption}>Transcribing on-device · no network</Text>
      </View>

      <Card variant="tint" style={styles.peek}>
        <Text style={styles.peekLabel}>Live transcript</Text>
        {peek.length === 0 ? (
          <Text style={styles.waiting}>Listening…</Text>
        ) : (
          peek.map((seg, i) => {
            const line = toDiarRow(seg);
            return <DiarRow key={i} speaker={line.speaker} spans={line.spans} faint={line.faint} />;
          })
        )}
      </Card>
    </ConsultScreen>
  );
}

const styles = StyleSheet.create({
  top: { alignItems: "center", paddingTop: space.sm },
  hero: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md },
  waveWrap: { width: "78%", height: 40 },
  timer: {
    fontSize: 34,
    fontWeight: "300",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
    marginTop: space.sm,
  },
  caption: { ...font.bodySm, color: colors.ink3 },
  peek: { gap: space.xs },
  peekLabel: { ...font.label, color: colors.ink3, marginBottom: space.xs },
  waiting: { ...font.body, color: colors.ink3 },
});
