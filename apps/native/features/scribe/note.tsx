import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Pressable, Switch, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { GlanceTile, IconRow, Section, Shelf } from "@/components/sona/sections";
import { Text } from "@/components/sona/text";
import { palette, type, radius } from "@/components/sona/theme";
import { Action, Chip, Expand, glass, Icon, Insight, Notice, Screen, SourceLink, Surface, Tone, useAccessibleEffects } from "@/components/sona/ui";
import { AskOrb } from "@/features/ask";
import { beforeSigning, noteNext } from "@/features/ask/answers";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps } from "@/features/encounter/types";
import { buildDraft, editNote, readNoteSections, scriptFor, sectionKeys, serializeNoteSections, type NoteSections } from "./model";
import { SampleLabel } from "@/components/sona/model-answer";
import { haptic, noteMeta, StateLine } from "./parts";
import { api, errorText, useLive } from "@/features/live";
import { noteSections, noteSentences } from "@/features/live/prescribing-sync";
import { LockedAction, useRole } from "@/features/live/roles";
import { NoVisit } from "@/components/sona/no-visit";

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
        <Text selectable style={{ ...type.footnote, lineHeight: 19, color: palette.muted }}>Dialogue sections are drafts to verify against source. Assessment and plan are clinician authored.</Text>
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
/** Section names as the heading counts what's still empty ("Assessment and plan empty"). */
const shortName: Record<keyof NoteSections, string> = { subjective: "History", objective: "Observations", assessment: "Assessment", plan: "Plan" };
const FOCUS ="rgba(36,91,204,0.4)";
const SPIN = { from: { transform: [{ rotate: "0deg" }] }, to: { transform: [{ rotate: "360deg" }] } };

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
    <Icon name={icon} size={15} color={palette.blue} /><Text style={{ ...type.subhead, fontWeight: "500", color: palette.blue }}>{label}</Text>
  </Pressable>;
}

/** Structured note: patient, one state line, four editable sections, and a floating bar to save. */
export function NoteScreen() {
  const { patient, encounter, updateEncounter, showDemoControls } = useEncounter();
  const { reducedMotion } = useAccessibleEffects();
  const [suggestion, setSuggestion] = useState<NoteSections>();
  const [failNextSave, setFailNextSave] = useState(false);
  const [prototype, setPrototype] = useState(false);
  const [focused, setFocused] = useState<keyof NoteSections>();
  const [info, setInfo] = useState<keyof NoteSections>();
  // Live: the doctor can keep this visit's note out of training (draft vs saved is otherwise a sample, if the patient consented).
  const [excludeFromTraining, setExcludeFromTraining] = useState(false);
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
      api.note.save({ encounterId, sentences: noteSentences(sections), expectedRevision: noteRevision.current, excludeFromTraining })
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
  if (!patient || !encounter) return <NoVisit view="note" what="a note" />;
  const sections = encounter.noteSectionDraft ?? encounter.noteSections ?? readNoteSections(encounter.note);
  const hasContent = sectionKeys.some(key => sections[key].trim().length > 0);
  const empty = sectionKeys.filter(key => !sections[key].trim()).map(key => shortName[key]);
  const emptyLine = empty.length > 2 ? `${empty.length} sections empty` : empty.length ? `${empty.map((name, i) => i ? name.toLowerCase() : name).join(" and ")} empty` : "";
  const status = encounter.noteSaveStatus ?? "idle";
  const saving = status === "saving";
  const editSection = (key: keyof NoteSections, value: string) => {
    updateEncounter(current => editNote(current, { ...(current.noteSectionDraft ?? current.noteSections ?? readNoteSections(current.note)), [key]: value }));
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
  // No visit captured yet: drafts come from the scripted sample consultation, labelled as a sample.
  const consultation = encounter.transcript.length ? encounter.transcript : scriptFor(encounter.language);
  const suggestionBlocked = encounter.transcriptDraft ? "Finish the pending transcript correction before a fresh draft." : undefined;
  // Sona beside the decision reads the page's own state; once saved, the visit's next step shows under the buttons.
  const noteState = { drafted: hasContent, saved: status === "saved", reviewed: encounter.noteReviewed, empty, unsureLines: encounter.transcript.filter(line => line.corrected && !line.englishReviewed).length,
    fromSample: Boolean(encounter.noteFromSample), plan: sections.plan, openTasks: encounter.tasks.filter(t => !t.completed).length };
  const next = noteNext(noteState);
  const orb = <AskOrb scope="note" answers={[beforeSigning(noteState)]} />;

  // One glass bar (the page's `Screen bottom`): the save state inline, the two note actions and Sona, then the next step.
  const bar = !canWrite ? <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><View style={{ flex: 1 }}><LockedAction label="Needs a doctor to write the note" path="note.save" height={48} /></View>{orb}</View> : <>
    <View accessible accessibilityLiveRegion="polite" accessibilityLabel={state.title} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 }}>
      <Animated.View key={state.title} entering={reducedMotion ? undefined : riseIn({ distance: 0, scale: 0.8, duration: 240 })}>
        <Animated.View style={{ animationName: saving && !reducedMotion ? SPIN : undefined, animationDuration: 1000, animationIterationCount: "infinite", animationTimingFunction: "linear" }}>
          <Icon name={state.icon} size={16} color={state.color} />
        </Animated.View>
      </Animated.View>
      <Text numberOfLines={2} style={{ ...type.footnote, flex: 1, fontWeight: "500", color: status === "failed" ? palette.amber : palette.ink }}>{state.title}</Text>
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ flex: 1 }}><Action label={saving ? "Saving…" : status === "failed" ? "Retry save" : "Save draft"} accessibilityLabel={status === "failed" ? "Retry saving draft" : undefined} icon="checkmark" disabled={!hasContent || saving} onPress={save} /></View>
      <View style={{ flex: 1 }}><Action label={encounter.noteReviewed ? "Reviewed" : "Mark reviewed"} accessibilityLabel={encounter.noteReviewed ? "Marked reviewed" : "Mark note reviewed"} secondary disabled={!hasContent || encounter.noteReviewed || saving || status !== "saved"} onPress={() => { Keyboard.dismiss(); haptic("done"); updateEncounter(current => ({ ...current, noteReviewed: true })); }} /></View>
      {orb}
    </View>
    {next && <QuietLink label={`Next: ${next.label}`} icon="arrow.right.circle" onPress={() => { haptic("tap"); router.push(next.op.slice(3) as never); }} />}
    {live && <Pressable accessibilityRole="switch" accessibilityLabel="Exclude this note from training" accessibilityHint="When on, saving keeps this visit's note out of the de-identified training data" accessibilityState={{ checked: excludeFromTraining }}
      onPress={() => setExcludeFromTraining(v => !v)} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 4 }}>
      <Text style={{ ...type.footnote, flex: 1, color: palette.muted }}>Exclude from training</Text>
      <Switch value={excludeFromTraining} onValueChange={setExcludeFromTraining} trackColor={{ true: palette.blue }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
    </Pressable>}
  </>;

  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}>
    <Screen bottom={bar}>
      <Animated.View entering={rise(0)} style={{ gap: 12 }}>
        <Insight eyebrow={patient.name}>{encounter.noteReviewed ? <Tone of="good">Reviewed</Tone> : !hasContent ? "Nothing drafted yet" : <>Draft{emptyLine ? <> · <Tone of="soon">{emptyLine}</Tone></> : null} · not reviewed</>}</Insight>
        <Text selectable style={{ ...type.footnote, lineHeight: 19, color: palette.muted }}>{live ? "Verify drafts against source." : "Verify drafts against source · local session only, no record connected."}</Text>
        {/* An empty note pulls in the consultation in one tap (the scripted sample until a visit is captured). */}
        {canWrite && !hasContent && !encounter.transcriptDraft && <View style={{ gap: 6 }}>
          <Action label="Draft from consultation" icon="waveform" onPress={() => { haptic("done"); const draft = readNoteSections(buildDraft(consultation)); updateEncounter(current => editNote(current, draft, !current.transcript.length)); }} />
          <SampleLabel source={encounter.transcript.length ? undefined : "fixture"} what="scribe" />
        </View>}
        {/* A note drafted from the scripted sample stays labelled until the clinician marks it reviewed. */}
        {hasContent && encounter.noteFromSample && !encounter.noteReviewed && <SampleLabel source="fixture" what="scribe" />}
        {encounter.transcript.some(line => line.corrected && !line.englishReviewed) && <StateLine warning>Unreviewed interpretations in the transcript. Check the original dialogue first.</StateLine>}
        {serverError && <StateLine warning>{serverError}</StateLine>}
      </Animated.View>

      {sectionKeys.map((key, index) => <Animated.View key={key} entering={rise(index + 1)} layout={layout} style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text accessibilityRole="header" style={{ ...type.headline, fontWeight: "600", letterSpacing: -0.3, color: palette.ink }}>{noteMeta[key].title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`About ${noteMeta[key].title}`} accessibilityState={{ expanded: info === key }} hitSlop={14} onPress={() => setInfo(current => current === key ? undefined : key)}>
            <Icon name={info === key ? "info.circle.fill" : "info.circle"} size={15} color={info === key ? palette.blue : palette.muted} />
          </Pressable>
        </View>
        {info === key && <Expand key={`info-${key}`} style={{ gap: 2 }}>
          <Text selectable style={{ ...type.footnote, lineHeight: 19, color: palette.muted }}>{framing[key]}</Text>
          {sources[key] && <SourceLink label={key === "subjective" ? "Review consultation / history source" : "Review observation source"} onPress={() => router.push({ pathname: "/source", params: { id: sources[key]!, patientId: patient.id } })} />}
        </Expand>}
        <Surface style={{ paddingHorizontal: 16, paddingVertical: 14, borderRadius: radius.group, borderColor: focused === key ? FOCUS : glass.rim, transitionProperty: "borderColor", transitionDuration: 160 } as never}>
          <TextInput accessibilityLabel={`Clinical note ${key}`} editable={canWrite} value={sections[key]} onChangeText={value => editSection(key, value)} onFocus={() => setFocused(key)} onBlur={() => setFocused(current => current === key ? undefined : current)} multiline placeholder={placeholders[key]} placeholderTextColor={palette.placeholder} textAlignVertical="top"
            style={{ minHeight: key === "subjective" ? 150 : 96, padding: 0, fontSize: type.body.fontSize, lineHeight: 25, color: palette.ink }} />
        </Surface>
      </Animated.View>)}

      <Animated.View entering={rise(5)} layout={layout} style={{ gap: 10 }}>
        {!canWrite ? null : suggestionBlocked ? <StateLine>{suggestionBlocked}</StateLine>
          : !suggestion && hasContent && <QuietLink label="Fresh draft from consultation" icon="doc.text.magnifyingglass" onPress={() => { haptic("tap"); setSuggestion(readNoteSections(buildDraft(consultation))); }} />}
        {suggestion && <Expand key="suggestion">
          <Surface style={{ padding: 18, gap: 14 }}>
            <Text style={{ ...type.caption, fontWeight: "600", letterSpacing: 0.3, color: palette.blue }}>New suggestion · not applied · your note stays until you replace it</Text>
            {sectionKeys.map(key => <View key={key} style={{ gap: 3 }}>
              <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>{noteMeta[key].title}</Text>
              <Text selectable style={{ ...type.callout, lineHeight: 22, color: suggestion[key].trim() ? palette.ink : palette.muted }}>{suggestion[key].trim() || "Left empty for you"}</Text>
            </View>)}
            <Action label="Replace note with this suggestion" onPress={() => { haptic("done"); updateEncounter(current => editNote(current, suggestion, !current.transcript.length)); setSuggestion(undefined); }} />
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
    </Screen>
  </KeyboardAvoidingView>;
}
