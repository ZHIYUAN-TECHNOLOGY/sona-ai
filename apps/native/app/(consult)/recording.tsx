import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { ConsultScreen } from "@/components/consult/ConsultScreen";
import { DiarRow } from "@/components/consult/DiarRow";
import { DeviceMicChip, RecDot } from "@/components/consult/LiveIndicators";
import type { SpeakerKey, TextSpan } from "@/components/consult/mockData";
import { consult } from "@/components/consult/mockData";
import { Pill } from "@/components/consult/Pill";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { CardHeading } from "@/components/consult/SectionLabel";
import { Waveform } from "@/components/consult/Waveform";
import { useConsultPipeline } from "@/lib/pipeline/PipelineProvider";
import type { RawSegment } from "@/lib/pipeline/mockStt";
import { colors } from "@/lib/theme";

// Map a live RawSegment onto DiarRow props: doctor lines are faint + "dr"; a
// Bahasa Malaysia line (lang "ms") is highlighted green; "mixed"/"en" render plain.
function toDiarRow(seg: RawSegment): { speaker: SpeakerKey; spans: TextSpan[]; faint: boolean } {
  const isDoctor = seg.speaker === "doctor";
  return {
    speaker: isDoctor ? "dr" : "pt",
    faint: isDoctor,
    spans: [{ text: seg.text, bm: seg.lang === "ms" }],
  };
}

// Screen 2 of 6 — Recording: live diarized transcript, waveform, mic + timer.
export default function RecordingScreen() {
  const { segments, startRecording } = useConsultPipeline();
  const started = useRef(false);

  // Kick off the on-device STT stream once, when the screen first focuses.
  useFocusEffect(
    useCallback(() => {
      if (started.current) return;
      started.current = true;
      startRecording();
    }, [startRecording]),
  );

  return (
    <ConsultScreen
      time="9:42"
      title="Recording"
      sub={consult.patientLabel}
      right={<Pill label={consult.langBadge} variant="green" />}
      footer={
        <View style={styles.footerRow}>
          <PrimaryButton label="Pause" variant="ghost" size="sm" style={styles.grow} />
          <PrimaryButton
            label="End consult"
            size="sm"
            style={styles.grow}
            onPress={() => router.push("/privacy")}
          />
        </View>
      }
    >
      <Card variant="tint">
        <View style={styles.capRow}>
          <View style={styles.rec}>
            <RecDot />
            <Text style={styles.timer}>00:47</Text>
          </View>
          <DeviceMicChip />
        </View>
        <View style={styles.waveWrap}>
          <Waveform />
        </View>
        <Text style={styles.micro}>Transcribing on-device, no network</Text>
      </Card>

      <Card style={styles.transcript}>
        <View style={styles.row}>
          <CardHeading>Live transcript</CardHeading>
          <Pill label="2 speakers" variant="blue" />
        </View>
        {segments.map((seg, i) => {
          const line = toDiarRow(seg);
          return <DiarRow key={i} speaker={line.speaker} spans={line.spans} faint={line.faint} />;
        })}
      </Card>
    </ConsultScreen>
  );
}

const styles = StyleSheet.create({
  capRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  rec: { flexDirection: "row", alignItems: "center", gap: 6 },
  timer: { fontSize: 12, fontWeight: "600", color: colors.ink, fontVariant: ["tabular-nums"] },
  waveWrap: { marginTop: 8 },
  micro: { marginTop: 4, fontSize: 10.5, color: colors.ink3, textAlign: "center" },
  transcript: { marginTop: 9 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  footerRow: { flexDirection: "row", gap: 8 },
  grow: { flex: 1 },
});
