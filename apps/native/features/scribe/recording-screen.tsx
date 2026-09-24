import { router, Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Keyboard, KeyboardAvoidingView, Pressable, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { Section } from "@/components/sona/sections";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, Chip, Expand, Icon, IconButton, Notice, Screen, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { useEncounter } from "@/features/encounter/store";
import type { TranscriptLine } from "@/features/encounter/types";
import { LiveWaveform } from "./live-waveform";
import { buildDraft, elapsedLabel, scriptFor } from "./model";
import { Dot, fieldStyle, haptic, StateLine } from "./parts";

type Capture = "ready" | "permission" | "denied" | "interrupted" | "failed" | "processing";
const RAIL = "rgba(20,28,40,0.12)";

function Label({ children }: { children: string }) {
  return <Text style={{ fontSize: 13, fontWeight: "600", color: palette.muted }}>{children}</Text>;
}

/** Speaker dot on a thin rail that links the dialogue top to bottom. */
function Rail({ tone, last, live = false, pulse = false }: { tone: string; last: boolean; live?: boolean; pulse?: boolean }) {
  return <View style={{ width: 10, alignItems: "center", paddingTop: 6 }}>
    <Dot color={tone} hollow={live} pulse={pulse} />
    {!last && <View style={{ flex: 1, width: 1, marginTop: 6, backgroundColor: RAIL }} />}
  </View>;
}

/** Text still arriving: muted, hollow pulsing dot, and a reminder it can't reach the note yet. */
function InterimSegment({ speaker, text, tone, reduced }: { speaker: string; text: string; tone: string; reduced: boolean }) {
  return <View accessible accessibilityLabel={`Interim, not finalized. ${speaker}: ${text}`} style={{ flexDirection: "row", gap: 12 }}>
    <Rail tone={tone} last live pulse={!reduced} />
    <View style={{ flex: 1, gap: 6, paddingBottom: 22 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: tone }}>{speaker}</Text>
        <Text style={{ fontSize: 12, color: palette.muted }}>Interim · not finalized</Text>
      </View>
      <Text style={{ fontSize: 16, lineHeight: 24, color: palette.muted }}>{text}…</Text>
      <Text style={{ fontSize: 12, lineHeight: 17, color: palette.muted }}>Provisional sample text cannot be used in a note until finalized.</Text>
    </View>
  </View>;
}

function TranscriptSegment({ line, interpretation, tone, last, fresh }: { line: TranscriptLine; interpretation: boolean; tone: string; last: boolean; fresh: boolean }) {
  const { encounter, updateEncounter } = useEncounter();
  const draft = encounter?.transcriptDraft;
  const editing = draft?.lineId === line.id;
  const speaker = editing ? draft.speaker : line.speaker;
  const original = editing ? draft.original : line.original;
  const english = editing ? draft.english ?? line.english : line.english;
  const updateDraft = (patch: { speaker?: string; original?: string; english?: string }) => {
    updateEncounter(current => current.transcriptDraft?.lineId === line.id
      ? { ...current, transcriptDraft: { ...current.transcriptDraft, ...patch } }
      : current);
  };
  const cancelEdit = () => {
    updateEncounter(current => current.transcriptDraft?.lineId === line.id ? { ...current, transcriptDraft: undefined } : current);
    Keyboard.dismiss();
  };
  const captured = scriptFor(encounter?.language ?? "english").find(value => value.id === line.id);
  const save = () => {
    const changed = speaker.trim() !== line.speaker || original.trim() !== line.original || english.trim() !== line.english;
    const interpretationConfirmed = interpretation && english.trim().length > 0;
    if (changed || interpretationConfirmed) {
      haptic("done");
      updateEncounter(current => ({ ...current, transcriptDraft: undefined, noteReviewed: false, transcript: current.transcript.map(value => value.id === line.id ? { ...value, speaker: speaker.trim(), original: original.trim(), english: english.trim(), englishReviewed: interpretationConfirmed || (original.trim() === line.original && value.englishReviewed), corrected: true } : value) }), true);
    } else cancelEdit();
    Keyboard.dismiss();
  };
  const startEdit = () => { haptic("tap"); updateEncounter(current => current.transcriptDraft ? current : { ...current, transcriptDraft: { lineId: line.id, speaker: line.speaker, original: line.original, english: line.english } }); };

  if (editing) return <View style={{ flexDirection: "row", gap: 12 }}>
    <Rail tone={tone} last={last} />
    <Animated.View entering={FadeIn.duration(180)} style={{ flex: 1, gap: 12, paddingBottom: 24 }}>
      <Label>Speaker label</Label>
      {/* The clinician assigns identity; nothing is inferred from diarization. */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {["Clinician", "Patient"].map(label => <Chip key={label} label={label} selected={speaker.trim() === label} onPress={() => updateDraft({ speaker: label })} accessibilityLabel={`Speaker is ${label}`} />)}
      </View>
      <TextInput accessibilityLabel="Speaker label" value={speaker} onChangeText={value => updateDraft({ speaker: value })} style={fieldStyle} />
      {interpretation ? <>
        <Label>Original · for comparison</Label>
        <Text selectable style={{ fontSize: 15, lineHeight: 22, color: palette.muted }}>{original}</Text>
        <Label>English interpretation · clinician edited</Label>
        <TextInput accessibilityLabel="Edit English interpretation" value={english} multiline onChangeText={value => updateDraft({ english: value })} style={[fieldStyle, { minHeight: 95 }]} textAlignVertical="top" />
      </> : <>
        <Label>Original text</Label>
        <TextInput accessibilityLabel="Correct original transcript" value={original} multiline onChangeText={value => updateDraft({ original: value })} style={[fieldStyle, { minHeight: 95 }]} textAlignVertical="top" />
      </>}
      <StateLine>Unfinished edits stay here when you leave. Saving applies them to the transcript.</StateLine>
      <Action label={interpretation ? "Confirm English interpretation" : "Save correction"} onPress={save} disabled={!speaker.trim() || !original.trim() || (interpretation && !english.trim())} />
      <Action label="Cancel edit" secondary onPress={cancelEdit} />
    </Animated.View>
  </View>;

  const locked = Boolean(draft);
  const shown = interpretation ? line.english : line.original;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${line.speaker}${line.corrected ? ", corrected" : ""}: ${shown}`} accessibilityHint={locked ? "Finish the current correction first" : interpretation ? "Review English interpretation" : "Correct text or speaker"} accessibilityState={{ disabled: locked }} disabled={locked} onPress={startEdit}
    style={({ pressed }) => ({ flexDirection: "row", gap: 12, transform: [{ scale: pressed ? 0.98 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
    <Rail tone={tone} last={last} />
    <Animated.View entering={fresh ? FadeIn.duration(220) : undefined} style={{ flex: 1, gap: 6, paddingBottom: 22 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 13, fontWeight: "600", color: tone }}>{line.speaker}{line.corrected ? <Text style={{ fontWeight: "400", color: palette.muted }}> · corrected</Text> : null}</Text>
        {!locked && <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Icon name="pencil" size={12} color={palette.blue} />
          <Text style={{ fontSize: 13, color: palette.blue }}>{interpretation ? "Review" : "Correct"}</Text>
        </View>}
      </View>
      <Text style={{ fontSize: 16, lineHeight: 24, color: palette.ink }}>{shown}</Text>
      {line.corrected && !line.englishReviewed && <StateLine warning>Original corrected. The English interpretation shown is a previous draft and needs review.</StateLine>}
      {line.englishReviewed && <StateLine icon="checkmark.circle">English interpretation · clinician confirmed</StateLine>}
      {line.corrected && captured && <View style={{ borderLeftWidth: 2, borderColor: RAIL, paddingLeft: 10, gap: 2 }}>
        <Text style={{ fontSize: 12, fontWeight: "600", color: palette.muted }}>Captured original · preserved</Text>
        <Text style={{ fontSize: 14, lineHeight: 20, color: palette.muted }}>{captured.speaker}: {captured.original}</Text>
      </View>}
    </Animated.View>
  </Pressable>;
}

function statusFor(capture: Capture, recording: string | undefined): { label: string; tone: string } {
  if (capture === "failed") return { label: "Capture failed · dialogue kept", tone: palette.amber };
  if (capture === "denied") return { label: "Permission unavailable", tone: palette.amber };
  if (capture === "processing") return { label: "Finalizing transcript", tone: palette.blue };
  if (recording === "recording") return { label: "Playing consultation sample", tone: palette.red };
  if (recording === "paused") return { label: "Sample paused", tone: palette.amber };
  if (recording === "stopped") return { label: "Transcript ready", tone: palette.green };
  return { label: "Ready for consultation", tone: palette.muted };
}

/**
 * Consultation capture. One feature surface holds the live state (status, clock, trace and the
 * controls for that state); the transcript grows beneath it as a rail of speaker turns.
 */
export function RecordingScreen() {
  const { patient, encounter, updateEncounter, showDemoControls } = useEncounter();
  const { reducedMotion } = useAccessibleEffects();
  const [interpretation, setInterpretation] = useState(false);
  const [capture, setCapture] = useState<Capture>("ready");
  const [prototype, setPrototype] = useState(false);
  // Lines already captured when the screen opens stay put; only new ones rise in.
  const [initialLines] = useState(() => encounter?.transcript.length ?? 0);
  const previousRecording = useRef(encounter?.recording);
  useEffect(() => {
    if (encounter?.recording === "stopped" && previousRecording.current !== "stopped") setCapture(current => current === "failed" ? current : "processing");
    previousRecording.current = encounter?.recording;
  }, [encounter?.recording]);
  useEffect(() => {
    if (capture !== "processing") return;
    const timer = setTimeout(() => setCapture("ready"), 700);
    return () => clearTimeout(timer);
  }, [capture]);
  const status = statusFor(capture, encounter?.recording);
  const announced = useRef(status.label);
  useEffect(() => { if (announced.current !== status.label) { announced.current = status.label; AccessibilityInfo.announceForAccessibility(status.label); } }, [status.label]);
  if (!patient || !encounter) return <Screen><Notice>Select a patient to open a consultation.</Notice></Screen>;

  const layout = reducedMotion ? undefined : LAYOUT;
  const active = encounter.recording === "recording";
  const paused = encounter.recording === "paused";
  const stopped = encounter.recording === "stopped";
  const idle = encounter.recording === "idle";
  const script = scriptFor(encounter.language);
  const total = script.length * 4;
  const unavailable = patient.id !== "SYN-1042";
  const nextSegment = script[encounter.transcript.length];
  const interim = active && encounter.recordingSeconds % 4 > 0 && nextSegment
    ? nextSegment.original.slice(0, Math.ceil(nextSegment.original.length * (encounter.recordingSeconds % 4) / 4)) : "";
  const partial = stopped && encounter.transcript.length < script.length;
  const play = () => { haptic("tap"); setCapture("ready"); updateEncounter(current => ({ ...current, recording: "recording" })); };
  const createDraft = () => { if (!encounter.note) updateEncounter(current => ({ ...current, note: buildDraft(current.transcript), noteReviewed: false })); router.push("/note"); };
  const canDraft = encounter.transcript.length > 0 && capture !== "processing" && !encounter.transcriptDraft;
  // Speakers take a colour in order of first appearance: the first blue, the rest ink.
  const firstSpeaker = encounter.transcript[0]?.speaker ?? script[0]?.speaker;
  const toneFor = (speaker: string) => speaker === firstSpeaker ? palette.blue : palette.ink;
  const lines = encounter.transcript;

  const minimizeLabel = active || paused ? "Minimize to encounter" : "Return to encounter";

  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}><Screen>
    {/* Minimize is the header's one control; playback keeps running from the encounter shell. */}
    <Stack.Screen options={{ headerLeft: () => <IconButton name="chevron.down" label={minimizeLabel} onPress={() => router.back()} /> }} />
    <View style={{ gap: 4 }}>
      <Text selectable style={{ fontSize: 13, fontWeight: "600", color: palette.blue }}>{patient.name} · {patient.id}</Text>
      <Text selectable style={{ fontSize: 13, lineHeight: 19, color: palette.muted }}>Scripted sample · no microphone active, no audio recorded.</Text>
    </View>

    {unavailable ? <Section title="No consultation sample" subtitle="This patient has incomplete history. A dialogue has not been authored for this encounter.">
      <Action label="Return to encounter" onPress={() => router.back()} />
    </Section> : <>
      <Surface feature layout={layout} style={{ padding: 22, gap: 18 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
          <Dot color={status.tone} pulse={active && !reducedMotion} />
          <Animated.View key={status.label} entering={reducedMotion ? undefined : FadeIn.duration(180)} style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: "600", color: palette.ink }}>{status.label}</Text>
          </Animated.View>
          {!idle && <Text style={{ fontSize: 12, color: palette.muted }}>{encounter.language === "manglish" ? "Manglish" : "English"}</Text>}
        </View>
        <View style={{ gap: 6 }}>
          <View accessible accessibilityLabel={`Elapsed ${elapsedLabel(encounter.recordingSeconds)} of ${elapsedLabel(total)}`} style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
            <Text selectable style={{ fontSize: 52, fontWeight: "300", color: palette.ink, letterSpacing: -2, fontVariant: ["tabular-nums"] }}>{elapsedLabel(encounter.recordingSeconds)}</Text>
            <Text style={{ fontSize: 17, color: palette.muted, fontVariant: ["tabular-nums"] }}>/ {elapsedLabel(total)}</Text>
          </View>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <LiveWaveform state={active ? "live" : idle ? "idle" : "held"} reducedMotion={reducedMotion} />
          </View>
        </View>

        {idle && <View style={{ gap: 10 }}>
          <Label>Sample language</Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Chip label="English" selected={encounter.language === "english"} onPress={() => updateEncounter(current => ({ ...current, language: "english" }))} />
            <Chip label="Manglish · Malay, English, Mandarin" selected={encounter.language === "manglish"} onPress={() => updateEncounter(current => ({ ...current, language: "manglish" }))} />
          </View>
        </View>}

        {(capture === "permission" || capture === "denied") && <Expand key="permission" style={{ gap: 12 }}>
          <Text style={{ fontSize: 12, fontWeight: "600", letterSpacing: 0.3, color: palette.blue }}>Synthetic permission state</Text>
          <Text style={{ ...type.headline, color: palette.ink }}>{capture === "denied" ? "Microphone access unavailable" : "Before a real consultation"}</Text>
          <Text selectable style={{ fontSize: 15, lineHeight: 22, color: palette.muted }}>{capture === "denied" ? "This fixture represents denied permission. No operating-system permission was requested. You can grant access in the simulation and continue." : "A connected recorder would request microphone permission and confirm consultation consent here. This prototype plays an authored sample without recording audio."}</Text>
          <Action label="Allow in simulation · play sample" icon="play.fill" onPress={play} />
          {capture === "permission" && <Action label="Simulate denied permission" secondary onPress={() => { haptic("warn"); setCapture("denied"); }} />}
        </Expand>}
        {capture === "failed" && <Expand key="failed" style={{ gap: 12 }}>
          <Text style={{ fontSize: 12, fontWeight: "600", letterSpacing: 0.3, color: palette.amber }}>Synthetic capture failure</Text>
          <Text style={{ ...type.headline, color: palette.ink }}>The sample was interrupted</Text>
          <Text selectable style={{ fontSize: 15, lineHeight: 22, color: palette.muted }}>Finalized dialogue and corrections are kept. Retry continues from the last sample position; it does not duplicate captured segments.</Text>
          <Action label="Retry remaining sample" icon="arrow.clockwise" onPress={play} />
        </Expand>}
        {capture === "interrupted" && <StateLine warning>Simulated interruption. Playback is paused and finalized transcript segments are preserved. Resume when ready.</StateLine>}
        {capture === "processing" && <StateLine>Finalizing the scripted transcript… Completed dialogue is preserved while this settles.</StateLine>}
        {paused && capture !== "interrupted" && <StateLine>Playback is paused. Leaving the app also pauses this sample; resume when ready.</StateLine>}
        {partial && <StateLine warning>Partial sample. Only the segments below can be included in a draft.</StateLine>}

        {idle && capture === "ready" && <Action label="Start sample" icon="play.fill" onPress={() => { haptic("tap"); setCapture("permission"); }} />}
        {(active || paused) && <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}><Action label={active ? "Pause sample" : "Resume sample"} icon={active ? "pause.fill" : "play.fill"} onPress={() => { haptic("tap"); setCapture("ready"); updateEncounter(current => ({ ...current, recording: active ? "paused" : "recording" })); }} /></View>
          <View style={{ flex: 1 }}><Action label="Stop sample" secondary icon="stop.fill" onPress={() => { haptic("tap"); updateEncounter(current => ({ ...current, recording: "stopped" })); }} /></View>
        </View>}
        {/* After a failure, Retry is this card's primary; the draft stays one tap away as a secondary. */}
        {stopped && <Action label={encounter.note ? "Open existing note" : "Create draft note"} icon="doc.text" secondary={capture === "failed"} disabled={!canDraft} onPress={createDraft} />}
        {partial && capture !== "failed" && <Action label="Continue remaining sample" secondary icon="play.fill" disabled={capture === "processing"} onPress={play} />}

        {showDemoControls && (active || paused) && <View style={{ flexDirection: "row" }}>
          <Chip label="Prototype controls" expanded={prototype} onPress={() => setPrototype(value => !value)} />
        </View>}
        {showDemoControls && (active || paused) && prototype && <Expand key="prototype" style={{ gap: 10 }}>
          <Text style={{ fontSize: 13, lineHeight: 19, color: palette.muted }}>Exercise recovery without using a microphone.</Text>
          <Action label="Simulate interruption" secondary onPress={() => { haptic("warn"); setCapture("interrupted"); updateEncounter(current => ({ ...current, recording: "paused" })); }} />
          <Action label="Simulate capture failure" secondary onPress={() => { haptic("warn"); setCapture("failed"); updateEncounter(current => ({ ...current, recording: "stopped" })); }} />
        </Expand>}
      </Surface>

      <Animated.View layout={layout}>
        <Section icon="waveform" tone="blue" title="Transcript" subtitle={!lines.length && !interim ? (stopped ? "No speech captured, so there is nothing to draft from." : "Dialogue appears here as the sample plays. Speaker labels are yours to confirm.") : interpretation ? "English interpretation, with the original kept for comparison." : "Original dialogue as captured. Tap a turn to correct its text or speaker."}>
          {lines.length > 0 && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Chip label="Original dialogue" selected={!interpretation} onPress={() => setInterpretation(false)} />
            <Chip label="English interpretation" selected={interpretation} onPress={() => setInterpretation(true)} />
          </View>}
          {encounter.transcriptDraft && <StateLine>Finish the current correction first. Other turns unlock once it is saved or cancelled.</StateLine>}
          {/* One keyed list: the interim turn keeps its key when it finalizes, so it settles in place. */}
          <View>{[
            ...lines.map((line, index) => <Animated.View key={line.id} layout={layout} entering={!reducedMotion && index >= initialLines ? riseIn({ distance: 10, duration: 320 }) : undefined}>
              <TranscriptSegment line={line} interpretation={interpretation} tone={toneFor(line.speaker)} last={index === lines.length - 1 && !interim} fresh={!reducedMotion && index >= initialLines} />
            </Animated.View>),
            interim && nextSegment ? <Animated.View key={nextSegment.id} layout={layout} entering={reducedMotion ? undefined : riseIn({ distance: 10, duration: 320 })} exiting={FadeOut.duration(140)}>
              <InterimSegment speaker={nextSegment.speaker} text={interim} tone={toneFor(nextSegment.speaker)} reduced={reducedMotion} />
            </Animated.View> : null,
          ]}</View>
        </Section>
      </Animated.View>
    </>}
  </Screen></KeyboardAvoidingView>;
}
