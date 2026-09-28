import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Pressable, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { GlanceTile, IconRow, Section, Shelf } from "@/components/sona/sections";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, Chip, Expand, Glass, glass, Icon, Notice, Screen, SourceLink, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps } from "@/features/encounter/types";
import { buildDraft, readNoteSections, sectionKeys, serializeNoteSections, type NoteSections } from "./model";
import { haptic, noteMeta, StateLine } from "./parts";
import { api, errorText, useLive } from "@/features/live";
import { noteSections, noteSentences } from "@/features/live/prescribing-sync";
import { LockedAction, useRole } from "@/features/live/roles";

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
    <Section icon="doc.text" tone="blue" title={note ? "Your consultation, captured" : "Room for the conversation"} subtitle={note ? encounter?.noteReviewed ? "Marked reviewed in this local session." : "Draft ready. Add your assessment and plan." : "Play a scripted sample, then draft an editable English note."}>
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

/** Provenance per section, shown on demand behind the ⓘ. */
const framing: Record<keyof NoteSections, string> = {
  subjective: "Drafted from the captured dialogue · verify against source.",
  objective: "Draft · verify against source.",
  assessment: "Clinician authored. A simulation assumption is never recorded as a confirmed assessment automatically.",
  plan: "Clinician authored · the next steps you agreed.",
};
const placeholders: Record<keyof NoteSections, string> = { subjective: "Captured symptoms and relevant history…", objective: "Document observations with units and dates…", assessment: "Record your clinical assessment…", plan: "Record the agreed next steps…" };
const FOCUS = "rgba(36,91,204,0.4)";
const SPIN = { from: { transform: [{ rotate: "0deg" }] }, to: { transform: [{ rotate: "360deg" }] } };
/** Room under the last section so the floating bar never covers it. */
const BAR_SPACE = 132;

/** Save state as one inline line in the action bar. */
function saveState(status: "idle" | "saving" | "saved" | "failed", reviewed: boolean) {
  if (status === "saving") return { icon: "arrow.triangle.2.circlepath", color: palette.blue, title: "Saving local draft…" };
  if (status === "failed") return { icon: "exclamationmark.circle", color: palette.amber, title: "Save failed · simulated · your edits are kept" };
  if (status === "saved") return reviewed
    ? { icon: "checkmark.seal.fill", color: palette.green, title: "Reviewed · any edit returns it to draft" }
    : { icon: "checkmark.circle.fill", color: palette.green, title: "Draft saved · not yet reviewed" };
  return { icon: "circle.dashed", color: palette.muted, title: "Not saved · save before marking reviewed" };
}

/** A quiet inline link; opens the transcript suggestion in place. */
function QuietLink({ label, icon, onPress }: { label: string; icon: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 7, alignSelf: "flex-start" }}>
    <Icon name={icon} size={15} color={palette.blue} /><Text style={{ fontSize: 14, fontWeight: "500", color: palette.blue }}>{label}</Text>
  </Pressable>;
}

/** Structured note: patient, one state line, four editable sections, and a floating bar to save. */
export function NoteScreen() {
  const { patient, encounter, updateEncounter, showDemoControls } = useEncounter();
  const { reducedMotion } = useAccessibleEffects();
  const insets = useSafeAreaInsets();
  const [suggestion, setSuggestion] = useState<NoteSections>();
  const [failNextSave, setFailNextSave] = useState(false);
  const [prototype, setPrototype] = useState(false);
  const [focused, setFocused] = useState<keyof NoteSections>();
  const [info, setInfo] = useState<keyof NoteSections>();
  const failSave = useRef(false);
  // Live: the note is read from and saved to the server as revisions; a save against an older one is refused.
  const { on: live } = useLive();
  // Only a doctor writes the note (note.save); other roles read it.
  const canWrite = useRole().can("note.save");
  const noteRevision = useRef(0);
  const [serverError, setServerError] = useState<string>();
  const encounterId = patient?.encounterId;
  useEffect(() => {
    if (!live || !encounterId) return;
    api.note.get({ encounterId }).then(({ revision, sentences }) => {
      noteRevision.current = revision;
      if (!sentences.length) return;
      const sections = noteSections(sentences);
      updateEncounter(current => ({ ...current, noteSections: sections, noteSectionDraft: undefined, note: serializeNoteSections(sections), noteSaveStatus: "saved" }));
    }).catch(e => setServerError(errorText(e)));
  }, [live, encounterId, updateEncounter]);
  useEffect(() => {
    if (encounter?.noteSaveStatus !== "saving") return;
    if (live && encounterId) {
      setServerError(undefined);
      const sections = encounter.noteSectionDraft ?? encounter.noteSections ?? readNoteSections(encounter.note);
      api.note.save({ encounterId, sentences: noteSentences(sections), expectedRevision: noteRevision.current })
        .then(({ revision }) => { noteRevision.current = revision; updateEncounter(current => ({ ...current, noteSections: sections, noteSectionDraft: current.noteSectionDraft === sections ? undefined : current.noteSectionDraft, noteSaveStatus: "saved" })); })
        .catch(e => { setServerError(errorText(e)); updateEncounter(current => ({ ...current, noteSaveStatus: "failed" })); });
      return;
    }
    const timer = setTimeout(() => {
      const failed = failSave.current;
      failSave.current = false;
      updateEncounter(current => current.noteSaveStatus !== "saving" ? current : failed
        ? { ...current, noteSaveStatus: "failed" }
        : { ...current, noteSections: current.noteSectionDraft ?? current.noteSections ?? readNoteSections(current.note), noteSectionDraft: undefined, noteSaveStatus: "saved" });
    }, 650);
    return () => clearTimeout(timer);
  }, [encounter?.noteSaveStatus, patient?.id, updateEncounter]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const suggestionBlocked = !encounter.transcript.length ? "No transcript captured for this encounter." : encounter.transcriptDraft ? "Finish the pending transcript correction before a fresh draft." : undefined;

  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}>
    <Screen>
      <Animated.View entering={rise(0)} style={{ gap: 12 }}>
        <Text selectable accessibilityRole="header" style={{ ...type.title, fontWeight: "600", color: palette.ink }}>{patient.name}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 11, backgroundColor: encounter.noteReviewed ? "rgba(40,104,80,0.1)" : "#E6EEFC" }}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: encounter.noteReviewed ? palette.green : palette.blue }}>{encounter.noteReviewed ? "Reviewed" : "Draft"}</Text>
          </View>
          <Text selectable style={{ flex: 1, fontSize: 13, lineHeight: 19, color: palette.muted }}>{live ? "Verify drafts against source · live: each save is a new note revision on the server." : "Verify drafts against source · local session only, no record connected."}</Text>
        </View>
        {encounter.transcript.some(line => line.corrected && !line.englishReviewed) && <StateLine warning>Unreviewed interpretations in the transcript. Check the original dialogue first.</StateLine>}
        {serverError && <StateLine warning>{serverError}</StateLine>}
      </Animated.View>

      {sectionKeys.map((key, index) => <Animated.View key={key} entering={rise(index + 1)} layout={layout} style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: "600", letterSpacing: -0.3, color: palette.ink }}>{noteMeta[key].title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`About ${noteMeta[key].title}`} accessibilityState={{ expanded: info === key }} hitSlop={14} onPress={() => setInfo(current => current === key ? undefined : key)}>
            <Icon name={info === key ? "info.circle.fill" : "info.circle"} size={15} color={info === key ? palette.blue : palette.muted} />
          </Pressable>
        </View>
        {info === key && <Expand key={`info-${key}`} style={{ gap: 2 }}>
          <Text selectable style={{ fontSize: 13, lineHeight: 19, color: palette.muted }}>{framing[key]}</Text>
          {sources[key] && <SourceLink label={key === "subjective" ? "Review consultation / history source" : "Review observation source"} onPress={() => router.push({ pathname: "/source", params: { id: sources[key]!, patientId: patient.id } })} />}
        </Expand>}
        <Surface style={{ paddingHorizontal: 16, paddingVertical: 14, borderRadius: 20, borderColor: focused === key ? FOCUS : glass.rim, transitionProperty: "borderColor", transitionDuration: 160 } as never}>
          <TextInput accessibilityLabel={`Clinical note ${key}`} editable={canWrite} value={sections[key]} onChangeText={value => editSection(key, value)} onFocus={() => setFocused(key)} onBlur={() => setFocused(current => current === key ? undefined : current)} multiline placeholder={placeholders[key]} placeholderTextColor="#A2A8B1" textAlignVertical="top"
            style={{ minHeight: key === "subjective" ? 150 : 96, padding: 0, fontSize: 16, lineHeight: 25, color: palette.ink }} />
        </Surface>
      </Animated.View>)}

      <Animated.View entering={rise(5)} layout={layout} style={{ gap: 10 }}>
        {!canWrite ? null : suggestionBlocked ? <StateLine>{suggestionBlocked}</StateLine>
          : !suggestion && <QuietLink label="Fresh draft from transcript" icon="doc.text.magnifyingglass" onPress={() => { haptic("tap"); setSuggestion(readNoteSections(buildDraft(encounter.transcript))); }} />}
        {suggestion && <Expand key="suggestion">
          <Surface style={{ padding: 18, gap: 14 }}>
            <Text style={{ fontSize: 12, fontWeight: "600", letterSpacing: 0.3, color: palette.blue }}>New suggestion · not applied · your note stays until you replace it</Text>
            {sectionKeys.map(key => <View key={key} style={{ gap: 3 }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: palette.muted }}>{noteMeta[key].title}</Text>
              <Text selectable style={{ fontSize: 15, lineHeight: 22, color: suggestion[key].trim() ? palette.ink : palette.muted }}>{suggestion[key].trim() || "Left empty for you"}</Text>
            </View>)}
            <Action label="Replace note with this suggestion" onPress={() => { haptic("done"); updateEncounter(current => ({ ...current, noteSectionDraft: suggestion, note: serializeNoteSections(suggestion), noteReviewed: false, noteSaveStatus: "idle" }), true); setSuggestion(undefined); }} />
            <Action label="Keep current note" secondary onPress={() => setSuggestion(undefined)} />
          </Surface>
        </Expand>}
      </Animated.View>

      {showDemoControls && <Animated.View entering={rise(6)} layout={layout} style={{ gap: 12 }}>
        <View style={{ flexDirection: "row" }}><Chip label="Prototype controls" expanded={prototype} onPress={() => setPrototype(value => !value)} /></View>
        {prototype && <Expand key="prototype" style={{ gap: 10 }}>
          <Action label={failNextSave ? "Next save will fail · cancel simulation" : "Simulate failure on next save"} secondary disabled={saving} onPress={() => setFailNextSave(value => !value)} />
        </Expand>}
      </Animated.View>}
      <View style={{ height: BAR_SPACE }} />
    </Screen>

    {/* One floating glass bar: the save state inline, then the two note actions. */}
    <Animated.View entering={rise(4)} style={{ position: "absolute", left: 16, right: 16, bottom: Math.max(insets.bottom, 12) }}>
      {!canWrite ? <Glass style={{ padding: 12 }}><LockedAction label="Needs a doctor to write the note" path="note.save" height={48} /></Glass> : <Glass style={{ padding: 12, gap: 10 }}>
        <View accessible accessibilityLiveRegion="polite" accessibilityLabel={state.title} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 }}>
          <Animated.View key={state.title} entering={reducedMotion ? undefined : riseIn({ distance: 0, scale: 0.8, duration: 240 })}>
            <Animated.View style={{ animationName: saving && !reducedMotion ? SPIN : undefined, animationDuration: 1000, animationIterationCount: "infinite", animationTimingFunction: "linear" }}>
              <Icon name={state.icon} size={16} color={state.color} />
            </Animated.View>
          </Animated.View>
          <Text numberOfLines={2} style={{ flex: 1, fontSize: 13, lineHeight: 18, fontWeight: "500", color: status === "failed" ? palette.amber : palette.ink }}>{state.title}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}><Action label={saving ? "Saving…" : status === "failed" ? "Retry save" : "Save draft"} accessibilityLabel={status === "failed" ? "Retry saving draft" : undefined} icon="checkmark" disabled={!hasContent || saving} onPress={save} /></View>
          <View style={{ flex: 1 }}><Action label={encounter.noteReviewed ? "Reviewed" : "Mark reviewed"} accessibilityLabel={encounter.noteReviewed ? "Marked reviewed" : "Mark note reviewed"} secondary disabled={!hasContent || encounter.noteReviewed || saving || status !== "saved"} onPress={() => { Keyboard.dismiss(); haptic("done"); updateEncounter(current => ({ ...current, noteReviewed: true })); }} /></View>
        </View>
      </Glass>}
    </Animated.View>
  </KeyboardAvoidingView>;
}
