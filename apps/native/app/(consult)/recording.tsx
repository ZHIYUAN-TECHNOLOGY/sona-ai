import { router, useFocusEffect, type Href } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { getConsult } from "@/lib/db";

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
import { useDiarizedTranscript } from "@/lib/diarize/useDiarizedTranscript";
import type { DiarTurn } from "@/lib/diarize/types";
import { haptic } from "@/lib/haptics";
import { useConsultPipeline } from "@/lib/pipeline/PipelineProvider";
import { getSttMode } from "@/lib/pipeline/sttMode";
import { colors, font, space } from "@/lib/theme";

type Mode = "transcribe" | "dictate";

// Map a diarized turn (doctor / patient / unknown, from the on-device diarizer) to a
// transcript row. Unknown (a third party — family, nurse) gets the neutral chip.
function toDiarRow(turn: DiarTurn): { speaker: SpeakerKey; spans: TextSpan[]; faint: boolean } {
  const speaker: SpeakerKey = turn.speaker === "doctor" ? "dr" : turn.speaker === "patient" ? "pt" : "other";
  return { speaker, faint: turn.speaker === "doctor", spans: [{ text: turn.text, bm: turn.lang === "ms" }] };
}

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Screen 2 of 6 — Recording. Big circular record affordance (Heidi-inspired),
// segmented Transcribe/Dictate toggle, a live ticking timer, and the transcript
// peeking below. The note template is chosen upstream on the New-consult screen.
// Consult states that mean recording is already OVER — a re-focus must NOT restart the mic.
const ENDED_STATUSES = new Set(["transcribing", "transcribed", "redacted", "noted"]);

export default function RecordingScreen() {
  const { consultId, status, segments, startRecording, stopRecording, cancelRecording } =
    useConsultPipeline();
  const started = useRef(false);
  const endedHere = useRef(false); // End was pressed on this screen (don't cancel on the resulting blur)
  const statusRef = useRef(status);
  statusRef.current = status; // read the freshest status inside the focus effect without re-subscribing

  // DIAGNOSTIC: the FK crash means a write hits a consult row that isn't there. Check it
  // exists the moment recording starts, so we know whether the consult was created at all.
  useEffect(() => {
    if (!consultId) return;
    void getConsult(consultId)
      .then((c) => {
        if (!c) Alert.alert("Consult row missing at record start", String(consultId));
      })
      .catch(() => {});
  }, [consultId]);
  const [mode, setMode] = useState<Mode>("transcribe");
  const [elapsed, setElapsed] = useState(0);
  const [ending, setEnding] = useState(false);

  useFocusEffect(
    useCallback(() => {
      // Returning to a consult that already ended (e.g. back-navigation) must NOT reopen the
      // mic. Forward to that consult's result instead of showing a fake live recorder.
      if (ENDED_STATUSES.has(statusRef.current)) {
        router.replace((getSttMode() === "real" ? "/label" : "/privacy") as Href);
        return;
      }
      if (!started.current) {
        started.current = true;
        haptic("recordStart");
        startRecording();
      }
      // Leaving the screen WITHOUT pressing End (tab switch, back-swipe) → stop the mic so no
      // orphan capture / orange indicator survives. End's own path already stopped it.
      return () => {
        if (!endedHere.current) cancelRecording();
      };
    }, [startRecording, cancelRecording]),
  );

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const turns = useDiarizedTranscript(segments);
  const peek = turns.slice(-3);
  // End the consult: stop recording (real path transcribes + diarizes on-device here; mock
  // path is instant), then move to the privacy gate. Guard against double-tap.
  const end = useCallback(async () => {
    if (ending) return;
    setEnding(true);
    endedHere.current = true; // mark so the blur cleanup doesn't double-cancel the (already stopped) mic
    try {
      const next = await stopRecording(); // real → label speakers; mock/demo → privacy
      // REPLACE (not push): drop the recording screen from the stack so back-navigation can
      // never return to a finished consult as a live recorder.
      router.replace((next === "label" ? "/label" : "/privacy") as Href);
    } finally {
      setEnding(false);
    }
  }, [ending, stopRecording]);

  return (
    <ConsultScreen
      time="9:42"
      title="Recording"
      sub={consult.patientLabel}
      right={<Pill label={consult.langBadge} variant="green" />}
      scroll={false}
      footer={
        <PrimaryButton
          label={ending ? "Transcribing on-device…" : "End consult"}
          onPress={end}
          disabled={ending}
        />
      }
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
          {/* Real mode: the STT capture owns the mic — keep the waveform DECORATIVE (live={false})
              so it doesn't open a second AudioRecorder and starve the STT capture of audio.
              Demo mode has no real capture, so the waveform can drive the mic itself. */}
          <Waveform live={getSttMode() !== "real"} />
        </View>
        <Text style={styles.caption}>Transcribing on-device · no network</Text>
      </View>

      <Card variant="tint" style={styles.peek}>
        <Text style={styles.peekLabel}>Live transcript · speakers separated on-device</Text>
        {peek.length === 0 ? (
          <Text style={styles.waiting}>Listening…</Text>
        ) : (
          peek.map((turn, i) => {
            const line = toDiarRow(turn);
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
