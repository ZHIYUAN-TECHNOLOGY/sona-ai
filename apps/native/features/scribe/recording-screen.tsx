import { PressScale } from "@/components/sona/parts";
import { router, Stack, useNavigation } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Keyboard, KeyboardAvoidingView, Pressable, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { SampleLabel } from "@/components/sona/model-answer";
import { Section } from "@/components/sona/sections";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, BackButton, Chip, Expand, Icon, Screen, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { useEncounterSelect } from "@/features/encounter/store";
import { sameShallow } from "@/features/live/keep-same";
import type { TranscriptLine } from "@/features/encounter/types";
import { JUDGE, useLive } from "@/features/live";
import { wantsLive } from "@/features/live/judge";
import { failedLine, heardLine, isCaption, mergeVoice, nameVoice, partRange, roleOf, ROLES, UNSURE, voiceLabel, voicesOf, type Part } from "./live";
import { RecordingSeconds, applyCaptured, applyDraft, askDraft, retryParts, useScribe } from "./live-recorder";
import { LiveWaveform } from "./live-waveform";
import { buildDraft, elapsedLabel, scriptFor } from "./model";
import { Dot, fieldStyle, haptic, StateLine } from "./parts";
import { NoVisit } from "@/components/sona/no-visit";
import { openPage } from "@/features/encounter/navigation";

type Capture = "ready" | "permission" | "denied" | "interrupted" | "failed" | "processing";
const RAIL = "rgba(20,28,40,0.12)";

function Label({ children }: { children: string }) {
  return <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>{children}</Text>;
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
        <Text style={{ ...type.footnote, fontWeight: "600", color: tone }}>{speaker}</Text>
        <Text style={{ ...type.caption, color: palette.muted }}>Interim · not finalized</Text>
      </View>
      <Text style={{ ...type.body, color: palette.muted }}>{text}…</Text>
      <Text style={{ ...type.caption, lineHeight: 17, color: palette.muted }}>Provisional sample text cannot be used in a note until finalized.</Text>
    </View>
  </View>;
}

/**
 * One turn of the transcript, tap to correct. `live`: what was heard is the only text (no separate English interpretation),
 * and a caption's label is its time, not a speaker, until the draft says who said what.
 */
function TranscriptSegment({ line, interpretation, tone, last, fresh, live = false }: { line: TranscriptLine; interpretation: boolean; tone: string; last: boolean; fresh: boolean; live?: boolean }) {
  const encounter = useEncounterSelect(s => s.encounter), updateEncounter = useEncounterSelect(s => s.updateEncounter);
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
      // Live: a line whose speaker changed moves to the person who has that label (or to nobody), so one line can be moved without renaming the whole voice.
      const moved = live && speaker.trim() !== line.speaker;
      updateEncounter(current => ({ ...current, transcriptDraft: undefined, noteReviewed: false, transcript: current.transcript.map(value => value.id === line.id ? { ...value, ...moved ? { voice: voicesOf(current.transcript).find(p => p.label === speaker.trim().replace(UNSURE, ""))?.voice } : {}, speaker: speaker.trim(), original: original.trim(), english: live ? original.trim() : english.trim(), englishReviewed: live || interpretationConfirmed || (original.trim() === line.original && value.englishReviewed), corrected: true } : value) }), true);
    } else cancelEdit();
    Keyboard.dismiss();
  };
  const startEdit = () => { haptic("tap"); updateEncounter(current => current.transcriptDraft ? current : { ...current, transcriptDraft: { lineId: line.id, speaker: line.speaker, original: line.original, english: line.english } }); };

  if (editing) return <View style={{ flexDirection: "row", gap: 12 }}>
    <Rail tone={tone} last={last} />
    <Animated.View entering={FadeIn.duration(180)} style={{ flex: 1, gap: 12, paddingBottom: 24 }}>
      {/* The clinician assigns identity; in live mode Sona's reading of who spoke is only a suggestion until confirmed here. */}
      {!(live && isCaption(line)) && <>
        <Label>Speaker label</Label>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {(live ? [...new Set([...ROLES, ...voicesOf(encounter?.transcript ?? []).map(p => p.label)])] : ["Clinician", "Patient"]).map(label => <Chip key={label} label={label} selected={speaker.trim() === label} onPress={() => updateDraft({ speaker: label })} accessibilityLabel={`Speaker is ${label}`} />)}
        </View>
        <TextInput accessibilityLabel="Speaker label" value={speaker} onChangeText={value => updateDraft({ speaker: value })} style={fieldStyle} />
      </>}
      {interpretation ? <>
        <Label>Original · for comparison</Label>
        <Text selectable style={{ ...type.callout, lineHeight: 22, color: palette.muted }}>{original}</Text>
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
  return <Pressable accessibilityRole="button" accessibilityLabel={`${line.speaker}${line.corrected ? ", corrected" : ""}: ${shown}`} accessibilityHint={locked ? "Finish the current correction first" : interpretation ? "Review English interpretation" : "Correct text or speaker"} accessibilityState={{ disabled: locked }} disabled={locked} onPress={startEdit}>{({ pressed }) => <PressScale pressed={pressed} scale={0.98} style={{ flexDirection: "row", gap: 12 }}>
    <Rail tone={tone} last={last} />
    <Animated.View entering={fresh ? FadeIn.duration(220) : undefined} style={{ flex: 1, gap: 6, paddingBottom: 22 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ flex: 1, ...type.footnote, fontWeight: "600", color: tone }}>{line.speaker}{line.corrected ? <Text style={{ fontWeight: "400", color: palette.muted }}> · corrected</Text> : null}</Text>
        {!locked && <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Icon name="pencil" size={12} color={palette.blue} />
          <Text style={{ ...type.footnote, color: palette.blue }}>{interpretation ? "Review" : "Correct"}</Text>
        </View>}
      </View>
      <Text style={{ ...type.body, color: palette.ink }}>{shown}</Text>
      {line.corrected && !line.englishReviewed && <StateLine warning>Original corrected. The English interpretation shown is a previous draft and needs review.</StateLine>}
      {line.englishReviewed && !live && <StateLine icon="checkmark.circle">English interpretation · clinician confirmed</StateLine>}
      {line.corrected && captured && <View style={{ borderLeftWidth: 2, borderColor: RAIL, paddingLeft: 10, gap: 2 }}>
        <Text style={{ ...type.caption, fontWeight: "600", color: palette.muted }}>Captured original · preserved</Text>
        <Text style={{ ...type.subhead, color: palette.muted }}>{captured.speaker}: {captured.original}</Text>
      </View>}
    </Animated.View>
  </PressScale>}</Pressable>;
}

function statusFor(capture: Capture, recording: string | undefined): { label: string; tone: string } {
  if (capture === "failed") return { label: "Capture failed · dialogue kept", tone: palette.amber };
  if (capture === "denied") return { label: "Permission unavailable", tone: palette.amber };
  if (capture === "processing") return { label: "Finalizing transcript", tone: palette.blue };
  if (recording === "recording") return { label: "Playing consultation", tone: palette.red };
  if (recording === "paused") return { label: "Paused", tone: palette.amber };
  if (recording === "stopped") return { label: "Transcript ready", tone: palette.green };
  return { label: "Ready for consultation", tone: palette.muted };
}

/** Consultation capture: the microphone in live mode (always, in the judge build), the scripted sample otherwise. */
export function RecordingScreen() {
  return wantsLive(JUDGE, useLive().on) ? <LiveRecording /> : <ScriptedRecording />;
}

const about = (minutes?: number) => !minutes ? "" : minutes <= 1 ? ", about a minute" : `, about ${minutes} min`;

/** Live: drafting first, then the recording's state and what is still being transcribed; the microphone's trouble when nothing could be recorded. */
function liveStatus(recording: string, { drafting, mic, pending, failed }: { drafting: boolean; mic?: string; pending: number; failed: number }): { label: string; tone: string } {
  if (drafting) return { label: "Drafting the note", tone: palette.blue };
  if (recording === "recording") return { label: "Recording consultation", tone: palette.red };
  if (mic && recording === "idle") return { label: "Microphone unavailable", tone: palette.amber };
  if (recording === "paused") return { label: "Paused", tone: palette.amber };
  if (recording === "stopped") return pending ? { label: "Transcribing the last part", tone: palette.blue } : failed ? { label: "Transcript incomplete", tone: palette.amber } : { label: "Transcript ready", tone: palette.green };
  return { label: "Ready to record", tone: palette.muted };
}

/** A part still on its way to the speech model, or one that failed: its time, and what is happening to it. */
function PartRow({ part, last, reduced }: { part: Part; last: boolean; reduced: boolean }) {
  const failed = part.status === "failed";
  const state = failed ? "Not transcribed" : part.status === "retrying" ? "Trying again…" : "Transcribing…";
  return <View accessible accessibilityLabel={`${partRange(part)}: ${state}`} style={{ flexDirection: "row", gap: 12 }}>
    <Rail tone={failed ? palette.amber : palette.muted} last={last} live={!failed} pulse={!failed && !reduced} />
    <View style={{ flex: 1, gap: 6, paddingBottom: 22 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <Text style={{ ...type.footnote, fontWeight: "600", color: failed ? palette.amber : palette.muted }}>{partRange(part)}</Text>
        <Text style={{ ...type.caption, color: palette.muted }}>{state}</Text>
      </View>
      {failed && <Text style={{ ...type.caption, lineHeight: 17, color: palette.muted }}>Its audio stays on this phone until it is transcribed.</Text>}
    </View>
  </View>;
}

/** Colour by meaning, never one hue a person: an unsure speaker amber (check it), the clinician blue, a caption's time muted; everyone else, a numbered voice included, ink. */
const liveTone = (line: TranscriptLine) => isCaption(line) ? palette.muted : line.speaker.endsWith(UNSURE) ? palette.amber : line.speaker === "Clinician" ? palette.blue : palette.ink;

/**
 * Live mode: the real microphone (./live-recorder, mounted with the shell, so minimizing keeps it recording). The same
 * feature surface holds state, clock and controls; captions arrive part by part beneath it, and the draft then marks
 * who said what. Stop, then draft: Gemma writes the note for review on the note screen.
 */
function LiveRecording() {
  const { patient, encounter, updateEncounter } = useEncounterSelect(s => ({ patient: s.patient, encounter: s.encounter, updateEncounter: s.updateEncounter }), sameShallow);
  const navigation = useNavigation();
  const { reducedMotion } = useAccessibleEffects();
  const scribe = useScribe(patient?.id);
  const [drafting, setDrafting] = useState(false);
  const [initialLines] = useState(() => encounter?.transcript.length ?? 0);
  const shown = useRef(true);
  useEffect(() => () => { shown.current = false; }, []);
  const waiting = scribe.parts.filter(p => p.status !== "done");
  const pending = waiting.filter(p => p.status !== "failed"), failed = waiting.filter(p => p.status === "failed");
  const status = liveStatus(encounter?.recording ?? "idle", { drafting, mic: scribe.mic, pending: pending.length, failed: failed.length });
  const announced = useRef(status.label);
  useEffect(() => { if (announced.current !== status.label) { announced.current = status.label; AccessibilityInfo.announceForAccessibility(status.label); } }, [status.label]);
  // Who was heard, as one line; it is announced when it changes, like the status.
  const people = voicesOf(encounter?.transcript ?? []);
  const heard = heardLine(people, encounter?.recording === "stopped");
  const insight = heard ? [heard.count, heard.names].filter(Boolean).join(", ") : "";
  const insightSaid = useRef(insight);
  useEffect(() => { if (insight && insightSaid.current !== insight) AccessibilityInfo.announceForAccessibility(insight); insightSaid.current = insight; }, [insight]);
  const [name, setName] = useState("");
  if (!patient || !encounter) return <NoVisit view="recording" what="a consultation" />;

  const layout = reducedMotion ? undefined : LAYOUT;
  const active = encounter.recording === "recording", paused = encounter.recording === "paused";
  const stopped = encounter.recording === "stopped", idle = encounter.recording === "idle";
  const lines = encounter.transcript;
  const starting = failed.find(p => p.starting)?.starting;
  const record = () => { haptic("tap"); updateEncounter(current => ({ ...current, recording: "recording" })); };
  const canDraft = !drafting && !pending.length && lines.length > 0 && !encounter.transcriptDraft;
  // The draft is applied for review even if the clinician has left this screen; only then does it open the note.
  const draft = async () => {
    if (encounter.note) return openPage(navigation, "/note");
    const owner = patient.id;
    haptic("tap"); setDrafting(true);
    try { applyDraft(owner, await askDraft(patient.encounterId, encounter.transcript), updateEncounter); haptic("done"); }
    catch (e) { applyCaptured(owner, e, updateEncounter); haptic("warn"); }
    if (!shown.current) return;
    setDrafting(false);
    openPage(navigation, "/note");
  };
  // Naming is optional and one person at a time: the first voice without a name, once the room is quiet enough to look.
  const asking = (stopped || paused) && !drafting && !encounter.transcriptDraft ? people.find(p => !p.named) : undefined;
  const guess = asking && roleOf(asking.label) ? asking.label : undefined;
  const known = people.filter(p => p.named);
  const settle = (next: (transcript: TranscriptLine[]) => TranscriptLine[]) => { haptic("done"); setName(""); updateEncounter(current => ({ ...current, transcript: next(current.transcript), noteReviewed: false })); };
  const subtitle = !lines.length && !waiting.length ? (stopped ? "No speech captured, so there is nothing to draft from." : "Captions appear here about every 30 seconds while you record.")
    : people.length && !encounter.note ? "Each voice is numbered as Sona hears it. Name them after you stop, or Sona reads who is who when it drafts the note."
    : lines.some(line => !isCaption(line)) ? "Who said what, as Sona read it; unsure speakers are amber. Tap a turn to correct it."
    : "Captions as heard, part by part. Tap one to correct a word; Sona marks who said what when it drafts the note.";

  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}><Screen>
    <Stack.Screen options={{ headerLeft: () => <BackButton label={active || paused ? "Minimize to encounter" : "Return to encounter"} /> }} />
    {/* Who, then one honesty line: the words are the speech model's, and the audio does not stay. */}
    <View style={{ gap: 4 }}>
      <Text selectable style={{ ...type.footnote, fontWeight: "500", color: palette.muted }}>{patient.name} · {patient.id}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
        <SampleLabel source="model" model="sona-asr" />
        <Text style={{ ...type.caption, color: palette.muted }}>· audio deleted once transcribed</Text>
      </View>
    </View>

    <Surface feature layout={layout} style={{ padding: 22, gap: 18 }}>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
          <Dot color={status.tone} pulse={active && !reducedMotion} />
          <Animated.View key={status.label} entering={reducedMotion ? undefined : FadeIn.duration(180)} style={{ flex: 1 }}>
            <Text style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>{status.label}</Text>
          </Animated.View>
        </View>
        {/* Where the doctor stands: only the names still open take a colour. */}
        {heard && <Text accessibilityLabel={insight} style={{ ...type.subhead, color: palette.ink }}>{heard.count}{heard.names ? <> · <Text style={heard.open ? { color: palette.amber } : undefined}>{heard.names}</Text></> : null}</Text>}
      </View>
      <View style={{ gap: 6 }}>
        {/* The clock ticks in its own store while recording, so only this text re-renders each second. */}
        <RecordingSeconds patientId={patient?.id} saved={encounter.recordingSeconds}>{seconds =>
          <Text accessibilityLabel={`Recorded ${elapsedLabel(seconds)}`} selectable style={{ fontSize: 52 /* timer numerals, off the scale */, fontWeight: "300", color: palette.ink, letterSpacing: -2, fontVariant: ["tabular-nums"] }}>{elapsedLabel(seconds)}</Text>}
        </RecordingSeconds>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <LiveWaveform state={active ? "live" : idle ? "idle" : "held"} reducedMotion={reducedMotion} />
        </View>
      </View>

      {idle && !scribe.mic && <StateLine>Tell the patient Sona is listening. Each part is sent to your hospital's server to be transcribed, then deleted.</StateLine>}
      {scribe.mic && !active && <StateLine warning>{scribe.mic}</StateLine>}
      {starting && <StateLine warning>{`Sona's speech model is starting${about(starting.minutes)}. Parts are kept on this phone until they can be transcribed.`}</StateLine>}
      {failed.length > 0 && <StateLine warning>{[failedLine(failed), !starting && failed[0]!.error].filter(Boolean).join(" ")}</StateLine>}
      {failed.length > 0 && <Action label={failed.length === 1 ? "Retry this part" : `Retry ${failed.length} parts`} secondary icon="arrow.clockwise" onPress={() => { haptic("tap"); retryParts(patient.id, updateEncounter); }} />}
      {paused && <StateLine>Paused. Leaving the app pauses too; what was said so far is kept.</StateLine>}

      {/* One tap names a voice; the audio is gone by now, so the doctor knows the voice by the longest thing it said. */}
      {asking && <Expand key="naming" style={{ gap: 12 }}>
        <Label>{`Who is ${voiceLabel(asking.voice)}?`}</Label>
        {guess && <Text style={{ ...type.footnote, color: palette.muted }}>Sona's guess: {guess}</Text>}
        <Text selectable style={{ ...type.callout, lineHeight: 22, color: palette.muted }}>“{asking.quote}”</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {ROLES.map(label => <Chip key={label} label={label} selected={label === guess} onPress={() => settle(t => nameVoice(t, asking.voice, label))} accessibilityLabel={`${voiceLabel(asking.voice)} is ${label === "Other" ? "someone else" : label === "Family" ? "family" : `the ${label.toLowerCase()}`}`} />)}
        </View>
        {known.length > 0 && <>
          <Label>Same person as</Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {known.map(person => <Chip key={person.voice} label={person.label} onPress={() => settle(t => mergeVoice(t, asking.voice, person.voice))} accessibilityLabel={`${voiceLabel(asking.voice)} is the same person as ${person.label}`} />)}
          </View>
        </>}
        <TextInput accessibilityLabel={`Type a name for ${voiceLabel(asking.voice)}`} placeholder="Or type a name" placeholderTextColor={palette.muted} value={name} onChangeText={setName} returnKeyType="done" onSubmitEditing={() => { if (name.trim()) settle(t => nameVoice(t, asking.voice, name)); }} style={fieldStyle} />
      </Expand>}

      {idle && <Action label="Start recording" icon="mic.fill" onPress={record} />}
      {(active || paused) && <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}><Action label={active ? "Pause" : "Resume"} icon={active ? "pause.fill" : "mic.fill"} onPress={() => { haptic("tap"); updateEncounter(current => ({ ...current, recording: active ? "paused" : "recording" })); }} /></View>
        <View style={{ flex: 1 }}><Action label="Stop" secondary icon="stop.fill" onPress={() => { haptic("tap"); updateEncounter(current => ({ ...current, recording: "stopped" })); }} /></View>
      </View>}
      {stopped && <Action label={drafting ? "Drafting note…" : encounter.note ? "Open note" : "Draft note"} icon="doc.text" disabled={!encounter.note && !canDraft} onPress={draft} />}
      {stopped && !drafting && <Action label="Record more" secondary icon="mic.fill" onPress={record} />}
    </Surface>

    <Animated.View layout={layout}>
      <Section icon="waveform" tone="blue" title="Transcript" subtitle={subtitle}>
        {encounter.transcriptDraft && <StateLine>Finish the current correction first. Other turns unlock once it is saved or cancelled.</StateLine>}
        {/* A part keeps its key when its words arrive, so the caption settles where "Transcribing…" was. */}
        <View>{[
          ...lines.map((line, index) => <Animated.View key={line.id} layout={layout} entering={!reducedMotion && index >= initialLines ? riseIn({ distance: 10, duration: 320 }) : undefined}>
            <TranscriptSegment line={line} interpretation={false} live tone={liveTone(line)} last={index === lines.length - 1 && !waiting.length} fresh={!reducedMotion && index >= initialLines} />
          </Animated.View>),
          ...waiting.map((part, index) => <Animated.View key={`part-${part.n}`} layout={layout} entering={reducedMotion ? undefined : riseIn({ distance: 10, duration: 320 })} exiting={FadeOut.duration(140)}>
            <PartRow part={part} last={index === waiting.length - 1} reduced={reducedMotion} />
          </Animated.View>),
        ]}</View>
      </Section>
    </Animated.View>
  </Screen></KeyboardAvoidingView>;
}

/**
 * The scripted sample (live mode off). One feature surface holds the live state (status, clock, trace and the
 * controls for that state); the transcript grows beneath it as a rail of speaker turns.
 */
function ScriptedRecording() {
  const { patient, encounter, updateEncounter, showDemoControls } = useEncounterSelect(s => ({ patient: s.patient, encounter: s.encounter, updateEncounter: s.updateEncounter, showDemoControls: s.showDemoControls }), sameShallow);
  const navigation = useNavigation();
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
  if (!patient || !encounter) return <NoVisit view="recording" what="a consultation" />;

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
  const createDraft = () => { if (!encounter.note) updateEncounter(current => ({ ...current, note: buildDraft(current.transcript), noteReviewed: false })); openPage(navigation, "/note"); };
  const canDraft = encounter.transcript.length > 0 && capture !== "processing" && !encounter.transcriptDraft;
  // Speakers take a colour in order of first appearance: the first blue, the rest ink.
  const firstSpeaker = encounter.transcript[0]?.speaker ?? script[0]?.speaker;
  const toneFor = (speaker: string) => speaker === firstSpeaker ? palette.blue : palette.ink;
  const lines = encounter.transcript;

  const minimizeLabel = active || paused ? "Minimize to encounter" : "Return to encounter";

  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}><Screen>
    {/* Back (minimize) is the header's one control; playback keeps running from the encounter shell. */}
    <Stack.Screen options={{ headerLeft: () => <BackButton label={minimizeLabel} /> }} />
    {/* Who, then one quiet honesty line: a sample (links to About data) with no microphone or audio. */}
    <View style={{ gap: 4 }}>
      <Text selectable style={{ ...type.footnote, fontWeight: "500", color: palette.muted }}>{patient.name} · {patient.id}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
        <SampleLabel source="fixture" what="speech" />
        <Text style={{ ...type.caption, color: palette.muted }}>· no microphone, no audio recorded</Text>
      </View>
    </View>

    {unavailable ? <Section icon="waveform.slash" tone="amber" title="No consultation sample"subtitle="This patient has incomplete history. A dialogue has not been authored for this encounter.">
      <Action label="Return to encounter" onPress={() => router.back()} />
    </Section> : <>
      <Surface feature layout={layout} style={{ padding: 22, gap: 18 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
          <Dot color={status.tone} pulse={active && !reducedMotion} />
          <Animated.View key={status.label} entering={reducedMotion ? undefined : FadeIn.duration(180)} style={{ flex: 1 }}>
            <Text style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>{status.label}</Text>
          </Animated.View>
          {!idle && <Text style={{ ...type.caption, color: palette.muted }}>{encounter.language === "manglish" ? "Manglish" : "English"}</Text>}
        </View>
        <View style={{ gap: 6 }}>
          <View accessible accessibilityLabel={`Elapsed ${elapsedLabel(encounter.recordingSeconds)} of ${elapsedLabel(total)}`} style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
            <Text selectable style={{ fontSize: 52 /* timer numerals, off the scale */, fontWeight: "300", color: palette.ink, letterSpacing: -2, fontVariant: ["tabular-nums"] }}>{elapsedLabel(encounter.recordingSeconds)}</Text>
            <Text style={{ ...type.body, color: palette.muted, fontVariant: ["tabular-nums"] }}>/ {elapsedLabel(total)}</Text>
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
          <Text style={{ ...type.caption, fontWeight: "600", letterSpacing: 0.3, color: palette.blue }}>Synthetic permission state</Text>
          <Text style={{ ...type.headline, color: palette.ink }}>{capture === "denied" ? "Microphone access unavailable" : "Before a real consultation"}</Text>
          <Text selectable style={{ ...type.callout, lineHeight: 22, color: palette.muted }}>{capture === "denied" ? "This fixture represents denied permission. No operating-system permission was requested. You can grant access in the simulation and continue." : "A connected recorder would request microphone permission and confirm consultation consent here. This prototype plays an authored sample without recording audio."}</Text>
          <Action label="Allow in simulation · play sample" icon="play.fill" onPress={play} />
          {showDemoControls && capture === "permission" && <Action label="Simulate denied permission" secondary onPress={() => { haptic("warn"); setCapture("denied"); }} />}
        </Expand>}
        {capture === "failed" && <Expand key="failed" style={{ gap: 12 }}>
          <Text style={{ ...type.caption, fontWeight: "600", letterSpacing: 0.3, color: palette.amber }}>Synthetic capture failure</Text>
          <Text style={{ ...type.headline, color: palette.ink }}>The sample was interrupted</Text>
          <Text selectable style={{ ...type.callout, lineHeight: 22, color: palette.muted }}>Finalized dialogue and corrections are kept. Retry continues from the last sample position; it does not duplicate captured segments.</Text>
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
          <Text style={{ ...type.footnote, lineHeight: 19, color: palette.muted }}>Exercise recovery without using a microphone.</Text>
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
