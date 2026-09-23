import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { GlanceTile, IconRow, Section, Shelf } from "@/components/sona/sections";
import { Text } from "@/components/sona/text";
import { palette } from "@/components/sona/theme";
import { Action, Chip, Expand, glass, Icon, Notice, Screen, SourceLink, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps } from "@/features/encounter/types";
import { buildDraft, readNoteSections, sectionKeys, serializeNoteSections, type NoteSections } from "./model";
import { haptic, noteMeta, StateLine } from "./parts";

const clip = (value: string, length = 140) => value.length > length ? `${value.slice(0, length).trimEnd()}…` : value;
const emptyDetail: Record<keyof NoteSections, string> = {
  subjective: "Nothing captured yet.",
  objective: "Not captured in this transcript.",
  assessment: "Yours to write. Sona leaves it empty.",
  plan: "Yours to write. Sona leaves it empty.",
};

/** The answer in the conversation: what the note holds, section by section, and one way in. */
export function NoteCard({ onOpen, onSource, patient }: FeatureProps) {
  const { encounter } = useEncounter();
  const note = encounter?.note;
  const sections = encounter && (encounter.noteSectionDraft ?? encounter.noteSections ?? readNoteSections(encounter.note));
  return <View style={{ gap: 18 }}>
    <Section title={note ? "Your consultation, captured" : "Room for the conversation"} subtitle={note ? encounter?.noteReviewed ? "Marked reviewed in this local session." : "Draft available. Review the captured dialogue and add your assessment." : "Start a consultation sample, then turn its captured dialogue into an editable English draft."}>
      {note && sections ? <View style={{ gap: 20 }}>
        {sectionKeys.map(key => <IconRow key={key} icon={noteMeta[key].icon} title={noteMeta[key].title} detail={sections[key].trim() ? clip(sections[key].trim()) : emptyDetail[key]} />)}
        <Text selectable style={{ fontSize: 13, lineHeight: 19, color: palette.muted }}>Dialogue sections are drafts to verify against source. Assessment and plan are clinician authored.</Text>
      </View> : <Shelf>
        <GlanceTile glyph="🎙️" value="1" label="Play the sample" caption="Scripted dialogue · no audio recorded" />
        <GlanceTile glyph="✍️" value="2" label="Correct it" caption="Speakers and text · original kept" />
        <GlanceTile glyph="🗒️" value="3" label="Draft the note" caption="Assessment and plan stay yours" />
      </Shelf>}
    </Section>
    {!encounter?.noteReviewed && encounter?.transcript.some(line => line.corrected) && <Notice warning>Transcript corrections require review against your note.</Notice>}
    <Action label={note ? "Open note" : "Open consultation"} icon={note ? "doc.text" : "waveform"} onPress={() => onOpen(note ? "note" : "recording")} />
    {patient.sources.some(source => source.id === "consultation") && <SourceLink label="Consultation sample provenance" onPress={() => onSource("consultation")} />}
  </View>;
}

const framing: Record<keyof NoteSections, string> = {
  subjective: "Drafted from the captured dialogue · verify against source.",
  objective: "Draft · verify against source.",
  assessment: "Clinician authored. A simulation assumption is never recorded as a confirmed assessment automatically.",
  plan: "Clinician authored · the next steps you agreed.",
};
const placeholders: Record<keyof NoteSections, string> = { subjective: "Captured symptoms and relevant history…", objective: "Document observations with units and dates…", assessment: "Record your clinical assessment…", plan: "Record the agreed next steps…" };
const FOCUS = "rgba(36,91,204,0.4)";
const SPIN = { from: { transform: [{ rotate: "0deg" }] }, to: { transform: [{ rotate: "360deg" }] } };

/** Save state as one line of meaning: icon, title and what it implies. */
function saveState(status: "idle" | "saving" | "saved" | "failed", reviewed: boolean) {
  if (status === "saving") return { icon: "arrow.triangle.2.circlepath", color: palette.blue, title: "Saving local draft…", detail: "You can continue editing; a changed draft cancels this save attempt." };
  if (status === "failed") return { icon: "exclamationmark.circle", color: palette.amber, title: "Save failed · simulated", detail: "All section edits remain available. Retry saves the current draft without replacing your text." };
  if (status === "saved") return reviewed
    ? { icon: "checkmark.seal.fill", color: palette.green, title: "Marked reviewed", detail: "Reviewed in this local session. Any edit returns it to draft." }
    : { icon: "checkmark.circle.fill", color: palette.green, title: "Draft saved", detail: "Saved in this local session. Saving doesn't mark the note reviewed." };
  return { icon: "circle.dashed", color: palette.muted, title: "Not saved yet", detail: "Save keeps this draft in the running app session. It doesn't mark the note reviewed." };
}

/** Structured note: four generated sections (heading, framing, editable block), then one place to save. */
export function NoteScreen() {
  const { patient, encounter, updateEncounter } = useEncounter();
  const { reducedMotion } = useAccessibleEffects();
  const [suggestion, setSuggestion] = useState<NoteSections>();
  const [failNextSave, setFailNextSave] = useState(false);
  const [prototype, setPrototype] = useState(false);
  const [focused, setFocused] = useState<keyof NoteSections>();
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
  // The haptic lands with the visual: when a save attempt settles.
  const lastStatus = useRef(encounter?.noteSaveStatus);
  useEffect(() => {
    const previous = lastStatus.current;
    lastStatus.current = encounter?.noteSaveStatus;
    if (previous === "saving" && encounter?.noteSaveStatus === "saved") haptic("done");
    if (previous === "saving" && encounter?.noteSaveStatus === "failed") haptic("warn");
  }, [encounter?.noteSaveStatus]);
  if (!patient || !encounter) return <Screen><Notice>Select a patient to open a note.</Notice></Screen>;
  const sections = encounter.noteSectionDraft ?? encounter.noteSections ?? readNoteSections(encounter.note);
  const hasContent = sectionKeys.some(key => sections[key].trim().length > 0);
  const status = encounter.noteSaveStatus ?? "idle";
  const saving = status === "saving";
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
  const state = saveState(status, encounter.noteReviewed);
  const layout = reducedMotion ? undefined : LAYOUT;
  // Sections arrive together with a short 40 ms stagger, once, when the note opens.
  const rise = (index: number) => reducedMotion ? undefined : riseIn({ delay: 40 * index, distance: 8, duration: 320 });

  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}><Screen>
    <Animated.View entering={rise(0)} style={{ gap: 12 }}>
      <Text selectable style={{ fontSize: 13, fontWeight: "600", color: palette.blue }}>{patient.name} · {patient.id}</Text>
      <Text style={{ fontSize: 22, lineHeight: 29, fontWeight: "600", letterSpacing: -0.5, color: palette.ink }}>The draft holds captured dialogue only. Your assessment and plan are separate, clinician-authored sections.</Text>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 11, backgroundColor: encounter.noteReviewed ? "rgba(40,104,80,0.1)" : "#E6EEFC" }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: encounter.noteReviewed ? palette.green : palette.blue }}>{encounter.noteReviewed ? "Reviewed" : "Draft"} · local session</Text>
        </View>
        <Text selectable style={{ flex: 1, fontSize: 13, lineHeight: 19, color: palette.muted }}>Edits stay in this running app session. No hospital record is connected; closing or resetting the app can clear them.</Text>
      </View>
      {encounter.transcript.some(line => line.corrected && !line.englishReviewed) && <Notice warning>The transcript includes unreviewed interpretations. Check the original dialogue before completing the English note.</Notice>}
    </Animated.View>

    {sectionKeys.map((key, index) => <Animated.View key={key} entering={rise(index + 1)}>
      <Section title={noteMeta[key].title} subtitle={framing[key]}>
        <Surface style={{ paddingHorizontal: 16, paddingVertical: 14, borderRadius: 20, borderColor: focused === key ? FOCUS : glass.rim, transitionProperty: "borderColor", transitionDuration: 160 } as never}>
          <TextInput accessibilityLabel={`Clinical note ${key}`} value={sections[key]} onChangeText={value => editSection(key, value)} onFocus={() => setFocused(key)} onBlur={() => setFocused(current => current === key ? undefined : current)} multiline placeholder={placeholders[key]} placeholderTextColor="#A2A8B1" textAlignVertical="top"
            style={{ minHeight: key === "subjective" ? 150 : 96, padding: 0, fontSize: 16, lineHeight: 25, color: palette.ink }} />
        </Surface>
        {sources[key] && <SourceLink label={key === "subjective" ? "Review consultation / history source" : "Review observation source"} onPress={() => router.push({ pathname: "/source", params: { id: sources[key]!, patientId: patient.id } })} />}
      </Section>
    </Animated.View>)}

    <Animated.View entering={rise(5)}>
      <Surface feature style={{ padding: 20, gap: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Animated.View key={state.title} entering={reducedMotion ? undefined : riseIn({ distance: 0, scale: 0.8, duration: 240 })}>
            <Animated.View style={{ animationName: saving && !reducedMotion ? SPIN : undefined, animationDuration: 1000, animationIterationCount: "infinite", animationTimingFunction: "linear" }}>
              <Icon name={state.icon} size={20} color={state.color} />
            </Animated.View>
          </Animated.View>
          <Text style={{ flex: 1, fontSize: 17, fontWeight: "600", letterSpacing: -0.3, color: palette.ink }}>{state.title}</Text>
        </View>
        <Text selectable style={{ fontSize: 14, lineHeight: 21, color: status === "failed" ? palette.amber : palette.muted }}>{state.detail}</Text>
        <Action label={saving ? "Saving draft…" : status === "failed" ? "Retry saving draft" : "Save draft"} icon="checkmark" disabled={!hasContent || saving} onPress={save} />
        <Action label={encounter.noteReviewed ? "Marked reviewed" : "Mark note reviewed"} secondary disabled={!hasContent || encounter.noteReviewed || saving || status !== "saved"} onPress={() => { Keyboard.dismiss(); haptic("done"); updateEncounter(current => ({ ...current, noteReviewed: true })); }} />
        <Text style={{ fontSize: 12, lineHeight: 17, color: palette.muted }}>Save the current draft before marking this note reviewed.</Text>
      </Surface>
    </Animated.View>

    <Animated.View entering={rise(6)} layout={layout}>
      <Section title="Fresh draft from the transcript" subtitle="Keep your words in control. A suggestion appears separately; your note stays intact until you explicitly replace it.">
        <Action label="Preview draft from transcript" secondary icon="doc.text.magnifyingglass" disabled={!encounter.transcript.length || Boolean(encounter.transcriptDraft)} onPress={() => { haptic("tap"); setSuggestion(readNoteSections(buildDraft(encounter.transcript))); }} />
        {!encounter.transcript.length && <StateLine>No transcript captured for this encounter.</StateLine>}
        {encounter.transcriptDraft && <StateLine>Finish the pending transcript correction before creating a new suggestion.</StateLine>}
        {suggestion && <Expand key="suggestion">
          <Surface style={{ padding: 18, gap: 14 }}>
            <Text style={{ fontSize: 12, fontWeight: "600", letterSpacing: 0.3, color: palette.blue }}>New suggestion · not applied</Text>
            {sectionKeys.map(key => <View key={key} style={{ gap: 3 }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: palette.muted }}>{noteMeta[key].title}</Text>
              <Text selectable style={{ fontSize: 15, lineHeight: 22, color: suggestion[key].trim() ? palette.ink : palette.muted }}>{suggestion[key].trim() || "Left empty for you"}</Text>
            </View>)}
            <Action label="Replace note with this suggestion" onPress={() => { haptic("done"); updateEncounter(current => ({ ...current, noteSectionDraft: suggestion, note: serializeNoteSections(suggestion), noteReviewed: false, noteSaveStatus: "idle" }), true); setSuggestion(undefined); }} />
            <Action label="Keep current note" secondary onPress={() => setSuggestion(undefined)} />
          </Surface>
        </Expand>}
      </Section>
    </Animated.View>

    <Animated.View entering={rise(7)} layout={layout} style={{ gap: 12 }}>
      <View style={{ flexDirection: "row" }}><Chip label="Prototype controls" expanded={prototype} onPress={() => setPrototype(value => !value)} /></View>
      {prototype && <Expand key="prototype" style={{ gap: 10 }}>
        <Text style={{ fontSize: 13, lineHeight: 19, color: palette.muted }}>Exercise save recovery with your current draft preserved.</Text>
        <Action label={failNextSave ? "Next save will fail · cancel simulation" : "Simulate failure on next save"} secondary disabled={saving} onPress={() => setFailNextSave(value => !value)} />
      </Expand>}
      <Action label="Done · keep draft and return" secondary onPress={() => { Keyboard.dismiss(); router.back(); }} />
    </Animated.View>
  </Screen></KeyboardAvoidingView>;
}
