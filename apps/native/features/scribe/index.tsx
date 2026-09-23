import { useReduceMotionPreference } from "@/components/sona/accessibility";
import { Text } from "@/components/sona/text";
import { Host, Picker } from "@expo/ui";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, Keyboard, KeyboardAvoidingView, TextInput, View } from "react-native";
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { Action, Body, Card, Glass, Icon, Label, Notice, Screen, SourceLink, Title } from "@/components/sona/ui";
import { palette } from "@/components/sona/theme";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps, TranscriptLine } from "@/features/encounter/types";
import { advancePlayback, buildDraft, elapsedLabel, readNoteSections, scriptFor, sectionKeys, serializeNoteSections, type NoteSections } from "./model";

/** Mount once in the encounter shell so minimizing the recorder keeps playback alive. */
export function ScribePlayback() {
  const { patient, encounter, updateEncounter } = useEncounter();
  useEffect(() => {
    if (encounter?.recording !== "recording") return;
    const timer = setInterval(() => updateEncounter(current => advancePlayback(current)), 1000);
    const listener = AppState.addEventListener("change", next => {
      if (next !== "active") updateEncounter(current => current.recording === "recording" ? { ...current, recording: "paused" } : current);
    });
    return () => { clearInterval(timer); listener.remove(); };
  }, [encounter?.recording, patient?.id, updateEncounter]);
  return null;
}

function WaveBar({ index, active }: { index: number; active: boolean }) {
  const reduced = useReduceMotionPreference();
  const level = useSharedValue(0.3);
  useEffect(() => {
    level.set(active && !reduced ? withRepeat(withTiming(1, { duration: 460 + (index % 5) * 95, easing: Easing.inOut(Easing.sin) }), -1, true) : withTiming(0.3, { duration: 160 }));
    return () => cancelAnimation(level);
  }, [active, index, level, reduced]);
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: level.get() }] }));
  return <Animated.View style={[{ width: 4, height: 16 + (index * 13 % 39), backgroundColor: palette.blue, borderRadius: 3 }, style]} />;
}

function TranscriptSegment({ line, interpretation }: { line: TranscriptLine; interpretation: boolean }) {
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
    if (changed || interpretationConfirmed) updateEncounter(current => ({ ...current, transcriptDraft: undefined, noteReviewed: false, transcript: current.transcript.map(value => value.id === line.id ? { ...value, speaker: speaker.trim(), original: original.trim(), english: english.trim(), englishReviewed: interpretationConfirmed || (original.trim() === line.original && value.englishReviewed), corrected: true } : value) }), true);
    else cancelEdit();
    Keyboard.dismiss();
  };
  return <Card label={`${line.speaker}${line.corrected ? " · corrected" : ""}`}>
    {editing ? <>
      <Label muted>Speaker label</Label>
      <TextInput accessibilityLabel="Speaker label" value={speaker} onChangeText={value => updateDraft({ speaker: value })} style={inputStyle} />
      {interpretation ? <><Label muted>Original · for comparison</Label><Body>{original}</Body><Label muted>English interpretation · clinician edited</Label><TextInput accessibilityLabel="Edit English interpretation" value={english} multiline onChangeText={value => updateDraft({ english: value })} style={[inputStyle, { minHeight: 95 }]} /></> : <><Label muted>Original text</Label><TextInput accessibilityLabel="Correct original transcript" value={original} multiline onChangeText={value => updateDraft({ original: value })} style={[inputStyle, { minHeight: 95 }]} /></>}
      <Body muted>Unfinished edits stay here when you leave. Save correction to apply them to the transcript.</Body>
      <Action label={interpretation ? "Confirm English interpretation" : "Save correction"} onPress={save} disabled={!speaker.trim() || !original.trim() || (interpretation && !english.trim())} />
      <Action label="Cancel edit" secondary onPress={cancelEdit} />
    </> : <>
      <Body>{interpretation ? line.english : line.original}</Body>
      {line.corrected && !line.englishReviewed && <Notice warning>Original corrected. The displayed English interpretation is a previous draft and needs review.</Notice>}
      {line.englishReviewed && <Label muted>English interpretation · clinician confirmed</Label>}
      {line.corrected && captured && <><Label muted>Captured original · preserved</Label><Body muted>{captured.speaker}: {captured.original}</Body></>}
      <Action label={draft ? "Finish the current correction first" : interpretation ? "Review English interpretation" : "Correct text or speaker"} secondary disabled={Boolean(draft)} onPress={() => updateEncounter(current => current.transcriptDraft ? current : { ...current, transcriptDraft: { lineId: line.id, speaker: line.speaker, original: line.original, english: line.english } })} />
    </>}
  </Card>;
}

export function RecordingScreen() {
  const { patient, encounter, updateEncounter } = useEncounter();
  const [interpretation, setInterpretation] = useState(false);
  const [capture, setCapture] = useState<"ready" | "permission" | "denied" | "interrupted" | "failed" | "processing">("ready");
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
  if (!patient || !encounter) return <Screen><Notice>Select a patient to open a consultation.</Notice></Screen>;
  const active = encounter.recording === "recording";
  const stopped = encounter.recording === "stopped";
  const unavailable = patient.id !== "SYN-1042";
  const nextSegment = scriptFor(encounter.language)[encounter.transcript.length];
  const interim = active && encounter.recordingSeconds % 4 > 0 && nextSegment
    ? nextSegment.original.slice(0, Math.ceil(nextSegment.original.length * (encounter.recordingSeconds % 4) / 4)) : "";
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}><Screen>
    <Label>{patient.name} · {patient.id}</Label>
    <Notice>Scripted playback · no microphone is active. This sample demonstrates the recording and transcription interface.</Notice>
    {unavailable ? <Card title="No consultation sample"><Body muted>This patient has incomplete history. A dialogue has not been authored for this encounter.</Body><Action label="Return to encounter" onPress={() => router.back()} /></Card> : <>
      {(capture === "permission" || capture === "denied") && <Card label="Synthetic permission state" title={capture === "denied" ? "Microphone access unavailable" : "Before a real consultation"}><Body muted>{capture === "denied" ? "This fixture represents denied permission. No operating-system permission was requested. You can grant access in the simulation and continue." : "A connected recorder would request microphone permission and confirm consultation consent here. This prototype plays an authored sample without recording audio."}</Body><Action label="Allow in simulation · play sample" onPress={() => { setCapture("ready"); updateEncounter(current => ({ ...current, recording: "recording" })); }} />{capture === "permission" && <Action label="Simulate denied permission" secondary onPress={() => setCapture("denied")} />}</Card>}
      {capture === "interrupted" && <Notice warning>Simulated interruption. Playback is paused and finalized transcript segments are preserved. Resume when ready.</Notice>}
      {capture === "failed" && <Card label="Synthetic capture failure" title="The sample was interrupted"><Body muted>Finalized dialogue and corrections are kept. Retry continues from the last sample position; it does not duplicate captured segments.</Body><Action label="Retry remaining sample" onPress={() => { setCapture("ready"); updateEncounter(current => ({ ...current, recording: "recording" })); }} /></Card>}
      {capture === "processing" && <Notice>Finalizing the scripted transcript… Completed dialogue is preserved while this UI state settles.</Notice>}
      <Glass style={{ padding: 26, alignItems: "center", gap: 18 }}>
        <Label>{capture === "failed" ? "Capture failed · dialogue kept" : capture === "denied" ? "Permission unavailable" : capture === "processing" ? "Finalizing transcript" : active ? "Playing consultation sample" : encounter.recording === "paused" ? "Sample paused" : stopped ? "Transcript ready" : "Ready for consultation"}</Label>
        <Text selectable accessibilityLabel={`Elapsed ${elapsedLabel(encounter.recordingSeconds)}`} style={{ fontSize: 52, fontWeight: "300", color: palette.ink, letterSpacing: -2, fontVariant: ["tabular-nums"] }}>{elapsedLabel(encounter.recordingSeconds)}</Text>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", gap: 4, height: 62, alignItems: "center" }}>{Array.from({ length: 23 }, (_, index) => <WaveBar key={index} index={index} active={active} />)}</View>
        <Text selectable style={{ fontSize: 12, color: palette.muted }}>Illustrative waveform · 12-second sample</Text>
      </Glass>
      {encounter.recording === "idle" && <Card label="Sample language"><Host matchContents colorScheme="light" seedColor={palette.blue}><Picker selectedValue={encounter.language} onValueChange={language => updateEncounter(current => ({ ...current, language }))}><Picker.Item label="English" value="english" /><Picker.Item label="Manglish · Malay, English, Mandarin" value="manglish" /></Picker></Host><Body muted>English clinical output with the original dialogue kept alongside.</Body></Card>}
      <View style={{ gap: 10 }}>
        {encounter.recording === "idle" && capture === "ready" && <Action label="Start sample" icon="play.fill" onPress={() => setCapture("permission")} />}
        {(active || encounter.recording === "paused") && <><Action label={active ? "Pause sample" : "Resume sample"} icon={active ? "pause.fill" : "play.fill"} onPress={() => { setCapture("ready"); updateEncounter(current => ({ ...current, recording: active ? "paused" : "recording" })); }} /><Action label="Stop sample" secondary icon="stop.fill" onPress={() => updateEncounter(current => ({ ...current, recording: "stopped" }))} /></>}
        <Action label={active || encounter.recording === "paused" ? "Minimize to encounter" : "Return to encounter"} secondary onPress={() => router.back()} />
      </View>
      {encounter.recording === "paused" && <Notice>Playback is paused. Leaving the app also pauses this sample; resume when ready.</Notice>}
      {interim && <Card label="Interim · not finalized"><Body muted>{interim}…</Body><Body muted>Provisional sample text cannot be used in a note until finalized.</Body></Card>}
      {encounter.transcript.length > 0 ? <>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}><Title>Transcript</Title><Icon name="text.bubble" color={palette.blue} /></View>
        <Host matchContents colorScheme="light" seedColor={palette.blue}><Picker selectedValue={interpretation ? "english" : "original"} onValueChange={value => setInterpretation(value === "english")}><Picker.Item label="Original dialogue" value="original" /><Picker.Item label="English interpretation" value="english" /></Picker></Host>
        {encounter.transcript.map(line => <TranscriptSegment key={line.id} line={line} interpretation={interpretation} />)}
      </> : <Card title={stopped ? "No speech captured" : "A little space to listen"}><Body muted>{stopped ? "The sample stopped before its first segment. No draft can be created from an empty transcript." : "Dialogue appears here as the sample plays. Speaker labels stay unassigned until you correct them."}</Body></Card>}
      {stopped && encounter.transcript.length < scriptFor(encounter.language).length && <Notice warning>Partial sample. Only the segments shown here can be included in a draft.</Notice>}
      {stopped && capture !== "failed" && encounter.transcript.length < scriptFor(encounter.language).length && <Action label="Continue remaining sample" secondary icon="play.fill" disabled={capture === "processing"} onPress={() => { setCapture("ready"); updateEncounter(current => ({ ...current, recording: "recording" })); }} />}
      {stopped && <Action label={encounter.note ? "Open existing note" : "Create draft note"} icon="doc.text" disabled={!encounter.transcript.length || capture === "processing" || Boolean(encounter.transcriptDraft)} onPress={() => { if (!encounter.note) updateEncounter(current => ({ ...current, note: buildDraft(current.transcript), noteReviewed: false })); router.push("/note"); }} />}
      {(active || encounter.recording === "paused") && <Card label="Prototype state controls"><Body muted>Exercise recovery without using a microphone.</Body><Action label="Simulate interruption" secondary onPress={() => { setCapture("interrupted"); updateEncounter(current => ({ ...current, recording: "paused" })); }} /><Action label="Simulate capture failure" secondary onPress={() => { setCapture("failed"); updateEncounter(current => ({ ...current, recording: "stopped" })); }} /></Card>}
    </>}
  </Screen></KeyboardAvoidingView>;
}

export function NoteCard({ onOpen, onSource, patient }: FeatureProps) {
  const { encounter } = useEncounter();
  return <Card label="Clinical documentation" title={encounter?.note ? "Your consultation, captured" : "Room for the conversation"}>
    <Body muted>{encounter?.note ? encounter.noteReviewed ? "Marked reviewed in this local session." : "Draft available. Review the captured dialogue and add your assessment." : "Start a consultation sample, then turn its captured dialogue into an editable English draft."}</Body>
    {encounter?.note && <Text selectable numberOfLines={5} style={{ fontSize: 15, lineHeight: 23, color: palette.ink }}>{encounter.note}</Text>}
    {!encounter?.noteReviewed && encounter?.transcript.some(line => line.corrected) && <Notice warning>Transcript corrections require review against your note.</Notice>}
    <Action label={encounter?.note ? "Open note" : "Open consultation"} icon={encounter?.note ? "doc.text" : "waveform"} onPress={() => onOpen(encounter?.note ? "note" : "recording")} />
    {patient.sources.some(source => source.id === "consultation") && <SourceLink label="Consultation sample provenance" onPress={() => onSource("consultation")} />}
  </Card>;
}

export function NoteScreen() {
  const { patient, encounter, updateEncounter } = useEncounter();
  const [suggestion, setSuggestion] = useState<NoteSections>();
  const [failNextSave, setFailNextSave] = useState(false);
  const failSave = useRef(false);
  useEffect(() => {
    if (encounter?.noteSaveStatus !== "saving") return;
    const timer = setTimeout(() => {
      const failed = failSave.current;
      failSave.current = false;
      updateEncounter(current => current.noteSaveStatus !== "saving" ? current : failed
        ? { ...current, noteSaveStatus: "failed" }
        : { ...current, noteSections: current.noteSectionDraft ?? current.noteSections ?? readNoteSections(current.note), noteSectionDraft: undefined, noteSaveStatus: "saved" });
    }, 650);
    return () => clearTimeout(timer);
  }, [encounter?.noteSaveStatus, patient?.id, updateEncounter]);
  if (!patient || !encounter) return <Screen><Notice>Select a patient to open a note.</Notice></Screen>;
  const sections = encounter.noteSectionDraft ?? encounter.noteSections ?? readNoteSections(encounter.note);
  const hasContent = sectionKeys.some(key => sections[key].trim().length > 0);
  const saving = encounter.noteSaveStatus === "saving";
  const editSection = (key: keyof NoteSections, value: string) => {
    updateEncounter(current => {
      const next = { ...(current.noteSectionDraft ?? current.noteSections ?? readNoteSections(current.note)), [key]: value };
      return { ...current, noteSectionDraft: next, note: serializeNoteSections(next), noteReviewed: false, noteSaveStatus: "idle" };
    }, true);
  };
  const save = () => {
    Keyboard.dismiss(); failSave.current = failNextSave; setFailNextSave(false);
    updateEncounter(current => ({ ...current, noteSaveStatus: "saving", noteReviewed: false }));
  };
  const sources: Partial<Record<keyof NoteSections, string>> = { subjective: patient.sources.some(source => source.id === "consultation") ? "consultation" : "history", objective: patient.sources.some(source => source.id === "vitals") ? "vitals" : "history" };
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}><Screen>
    <Label>{patient.name} · {patient.id}</Label>
    <Card label={encounter.noteReviewed ? "Reviewed · local session" : "Draft · local session"} title="Clinical note">
      <Notice>Edits stay in this running app session. No hospital record is connected; closing or resetting the app can clear them.</Notice>
      {encounter.transcript.some(line => line.corrected && !line.englishReviewed) && <Notice warning>The transcript includes unreviewed interpretations. Check the original dialogue before completing the English note.</Notice>}
      <Body muted>The consultation draft contains captured dialogue only. Your assessment and plan are separate clinician-authored sections.</Body>
    </Card>
    {sectionKeys.map(key => <Card key={key} label={key === "assessment" || key === "plan" ? "Clinician authored" : "Draft · verify against source"} title={{ subjective: "Consultation & history", objective: "Observations", assessment: "Clinician assessment", plan: "Plan" }[key]}>
      <TextInput accessibilityLabel={`Clinical note ${key}`} value={sections[key]} onChangeText={value => editSection(key, value)} multiline placeholder={{ subjective: "Captured symptoms and relevant history…", objective: "Document observations with units and dates…", assessment: "Record your clinical assessment…", plan: "Record the agreed next steps…" }[key]} placeholderTextColor={palette.muted} style={[inputStyle, { minHeight: key === "subjective" ? 160 : 105, fontSize: 16, lineHeight: 25 }]} textAlignVertical="top" />
      {sources[key] && <SourceLink label={key === "subjective" ? "Review consultation / history source" : "Review observation source"} onPress={() => router.push({ pathname: "/source", params: { id: sources[key]!, patientId: patient.id } })} />}
      {key === "assessment" && <Body muted>Entered by you. A simulation assumption is never recorded as a confirmed assessment automatically.</Body>}
    </Card>)}
    <Card label="Draft status">
      {encounter.noteSaveStatus === "failed" && <Notice warning>Simulated save failed. All section edits remain available. Retry saves the current draft without replacing your text.</Notice>}
      {encounter.noteSaveStatus === "saved" && <Notice>Draft saved in this local session.</Notice>}
      {saving && <Notice>Saving local draft… You can continue editing; a changed draft cancels this save attempt.</Notice>}
      <Action label={saving ? "Saving draft…" : encounter.noteSaveStatus === "failed" ? "Retry saving draft" : "Save draft"} icon="checkmark" disabled={!hasContent || saving} onPress={save} />
      <Action label={encounter.noteReviewed ? "Marked reviewed" : "Mark note reviewed"} secondary disabled={!hasContent || encounter.noteReviewed || saving || encounter.noteSaveStatus !== "saved"} onPress={() => { Keyboard.dismiss(); updateEncounter(current => ({ ...current, noteReviewed: true })); }} />
      <Body muted>Save the current draft before marking this note reviewed.</Body>
    </Card>
    <Card label="Transcript → draft" title="Keep your words in control">
      <Body muted>A fresh suggestion appears separately. Your current note stays intact until you explicitly replace it.</Body>
      <Action label="Preview draft from transcript" secondary disabled={!encounter.transcript.length || Boolean(encounter.transcriptDraft)} onPress={() => setSuggestion(readNoteSections(buildDraft(encounter.transcript)))} />
      {!encounter.transcript.length && <Body muted>No transcript captured for this encounter.</Body>}
      {encounter.transcriptDraft && <Notice>Finish the pending transcript correction before creating a new suggestion.</Notice>}
      {suggestion && <><Label>New suggestion · not applied</Label><Body>{serializeNoteSections(suggestion)}</Body><Action label="Replace note with this suggestion" onPress={() => { updateEncounter(current => ({ ...current, noteSectionDraft: suggestion, note: serializeNoteSections(suggestion), noteReviewed: false, noteSaveStatus: "idle" }), true); setSuggestion(undefined); }} /><Action label="Keep current note" secondary onPress={() => setSuggestion(undefined)} /></>}
    </Card>
    <Card label="Prototype state controls"><Body muted>Exercise save recovery with your current draft preserved.</Body><Action label={failNextSave ? "Next save will fail · cancel simulation" : "Simulate failure on next save"} secondary disabled={saving} onPress={() => setFailNextSave(value => !value)} /></Card>
    <Action label="Done · keep draft and return" secondary onPress={() => { Keyboard.dismiss(); router.back(); }} />
  </Screen></KeyboardAvoidingView>;
}

const inputStyle = { backgroundColor: "#EEF1F5", borderRadius: 14, padding: 14, minHeight: 48, color: palette.ink, fontSize: 16, lineHeight: 24 } as const;
