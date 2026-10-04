import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Keyboard, Pressable, Switch, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { GlanceTile, IconRow, Section, Shelf } from "@/components/sona/sections";
import { Text } from "@/components/sona/text";
import { palette, type, radius } from "@/components/sona/theme";
import { Action, Chip, Expand, glass, Icon, Insight, Notice, Screen, SourceLink, Surface, Tone, useAccessibleEffects } from "@/components/sona/ui";
import { noteNext } from "@/features/ask/answers";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps } from "@/features/encounter/types";
import { buildDraft, editNote, readNoteSections, scriptFor, sectionKeys, serializeNoteSections, type NoteSections } from "./model";
import { SampleLabel } from "@/components/sona/model-answer";
import { haptic, noteMeta, StateLine } from "./parts";
import { draftFrom, draftOrigin, failedLine, UNSURE, type LiveDraft } from "./live";
import { applyCaptured, applyDraft, askDraft, useScribe } from "./live-recorder";
import { api, errorText, JUDGE, useLive } from "@/features/live";
import { wantsLive } from "@/features/live/judge";
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
  // The judge build only ever records: the scripted sample's wording never shows, even before the sign-in is known.
  const live = wantsLive(JUDGE, useLive().on);
  const drafted = useScribe(patient.id).draft?.source === "model";
  const note = encounter?.note;
  const sections = encounter && (encounter.noteSectionDraft ?? encounter.noteSections ?? readNoteSections(encounter.note));
  return <View style={{ gap: 18 }}>
    <Section icon="doc.text" tone="blue" title={note ? "Your consultation, captured" : "Room for the conversation"} subtitle={note ? encounter?.noteReviewed ? "Marked reviewed in this local session." : drafted ? "Sona's draft is ready for your review." : "Draft ready. Add your assessment and plan." : live ? "Record the consultation, then review the note Sona drafts from it." : "Play a scripted sample, then draft an editable English note."}>
      {note && sections ? <View style={{ gap: 20 }}>
        {sectionKeys.map(key => <IconRow key={key} icon={noteMeta[key].icon} title={noteMeta[key].title} detail={sections[key].trim() ? clip(sections[key].trim()) : emptyDetail[key]} />)}
        <Text selectable style={{ ...type.footnote, lineHeight: 19, color: palette.muted }}>{drafted ? "Sona drafted every section from the consultation, assessment and plan only from what you said. Check each against the transcript." : "Dialogue sections are drafts to verify against source. Assessment and plan are clinician authored."}</Text>
      </View> : live ? <Shelf>
        <GlanceTile glyph="🎙️" value="1" label="Record it" caption="Microphone · audio deleted once transcribed" />
        <GlanceTile glyph="✍️" value="2" label="Correct it" caption="Words and speakers · yours to confirm" />
        <GlanceTile glyph="🗒️" value="3" label="Review the draft" caption="Sona drafts it · you decide" />
      </Shelf> : <Shelf>
        <GlanceTile glyph="🎙️" value="1" label="Play the sample" caption="Scripted dialogue · no audio recorded" />
        <GlanceTile glyph="✍️" value="2" label="Correct it" caption="Speakers and text · original kept" />
        <GlanceTile glyph="🗒️" value="3" label="Draft the note" caption="Assessment and plan stay yours" />
      </Shelf>}
    </Section>
    {!encounter?.noteReviewed && encounter?.transcript.some(line => line.corrected) && <Notice warning>Transcript corrections require review against your note.</Notice>}
    <Action label={note ? "Open note" : "Open consultation"} icon={note ? "doc.text" : "waveform"} onPress={() => onOpen(note ? "note" : "recording")} />
    {!JUDGE && patient.sources.some(source => source.id === "consultation") && <SourceLink label="Consultation sample provenance" onPress={() => onSource("consultation")} />}
  </View>;
}

/** Provenance per section, shown on demand behind the ⓘ. */
const framing: Record<keyof NoteSections, string> = {
  subjective: "Drafted from the captured dialogue · verify against source.",
  objective: "Draft · verify against source.",
  assessment: JUDGE ? "Clinician authored · your clinical assessment." : "Clinician authored. A simulation assumption is never recorded as a confirmed assessment automatically.",
  plan: "Clinician authored · the next steps you agreed.",
};
const placeholders: Record<keyof NoteSections, string> = { subjective: "Captured symptoms and relevant history…", objective: "Document observations with units and dates…", assessment: "Record your clinical assessment…", plan: "Record the agreed next steps…" };
/** Section names as the heading counts what's still empty ("Assessment and plan empty"). */
const shortName: Record<keyof NoteSections, string> = { subjective: "History", objective: "Observations", assessment: "Assessment", plan: "Plan" };
const FOCUS ="rgba(36,91,204,0.4)";
const SPIN = { from: { transform: [{ rotate: "0deg" }] }, to: { transform: [{ rotate: "360deg" }] } };

/** Save state as one inline line in the action bar. */
function saveState(status: "idle" | "saving" | "saved" | "failed", reviewed: boolean) {
  // The judge build saves to the hospital record, so a failed save is the server's (its reason shows above), never a rehearsed one.
  if (status === "saving") return { icon: "arrow.triangle.2.circlepath", color: palette.blue, title: JUDGE ? "Saving draft…" : "Saving local draft…" };
  if (status === "failed") return { icon: "exclamationmark.circle", color: palette.amber, title: JUDGE ? "Save failed · your edits are kept" : "Save failed · simulated · your edits are kept" };
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
  // Live: a recorded consultation is drafted by Gemma (note.draft); `pendingDraft` is a fresh draft offered beside the note.
  const scribe = useScribe(patient?.id);
  const [drafting, setDrafting] = useState(false);
  const pendingDraft = useRef<LiveDraft>(undefined);
  // Live: the doctor can keep this visit's note out of training (draft vs saved is otherwise a sample, if the patient consented).
  const [excludeFromTraining, setExcludeFromTraining] = useState(false);
  const failSave = useRef(false);
  // Live: the note is read from and saved to the server as revisions; a save against an older one is refused.
  const live = wantsLive(JUDGE, useLive().on);
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
  // The record's "consultation" source is the scripted dialogue, so the judge build points at the history instead.
  const sources: Partial<Record<keyof NoteSections, string>> = { subjective: !JUDGE && patient.sources.some(source => source.id === "consultation") ? "consultation" : "history", objective: patient.sources.some(source => source.id === "vitals") ? "vitals" : "history" };
  const state = saveState(status, encounter.noteReviewed);
  const layout = reducedMotion ? undefined : LAYOUT;
  // Sections arrive together with a short 40 ms stagger, once, when the note opens.
  const rise = (index: number) => reducedMotion ? undefined : riseIn({ delay: 40 * index, distance: 8, duration: 320 });
  // A consultation recorded in live mode is drafted by Gemma from its own transcript, then labelled by where the draft came from.
  const from = draftFrom(JUDGE, live, encounter.transcript.length);
  const fromRecording = from === "recording";
  // Demo, no visit captured yet: drafts come from the scripted sample consultation, labelled as a sample.
  const consultation = encounter.transcript.length || from === "nothing" ? encounter.transcript : scriptFor(encounter.language);
  const liveDraft = scribe.draft;
  const unsure = encounter.transcript.filter(line => line.speaker.endsWith(UNSURE)).length;
  const missing = scribe.parts.filter(part => part.status === "failed");
  const draftLive = async (offer: boolean) => {
    const owner = patient.id;
    haptic("tap"); setDrafting(true); setServerError(undefined);
    try {
      const draft = await askDraft(patient.encounterId, encounter.transcript);
      if (offer) { pendingDraft.current = draft; setSuggestion(draft.sections); } else applyDraft(owner, draft, updateEncounter);
      haptic("done");
    } catch (e) {
      if (offer) setServerError(errorText(e)); else applyCaptured(owner, e, updateEncounter);
      haptic("warn");
    }
    setDrafting(false);
  };
  const offered = pendingDraft.current && draftOrigin(pendingDraft.current);
  const suggestionBlocked = encounter.transcriptDraft ? "Finish the pending transcript correction before a fresh draft." : undefined;
  // Sona beside the decision reads the page's own state; once saved, the visit's next step shows under the buttons.
  const noteState = { drafted: hasContent, saved: status === "saved", reviewed: encounter.noteReviewed, empty, unsureLines: encounter.transcript.filter(line => line.corrected && !line.englishReviewed).length,
    fromSample: Boolean(encounter.noteFromSample), plan: sections.plan, openTasks: encounter.tasks.filter(t => !t.completed).length };
  const next = noteNext(noteState);

  // An empty note pulls in the consultation in one tap (the scripted sample until a visit is captured).
  const draftNote = () => { if (from === "nothing") return; if (fromRecording) return void draftLive(false); haptic("done"); const draft = readNoteSections(buildDraft(consultation)); updateEncounter(current => editNote(current, draft, !current.transcript.length)); };
  // One glass bar (the page's `Screen bottom`) with only what applies: an empty note's way in (or why it waits), else the save state
  // inline, the two note actions and the next step. It always holds something, so the first word typed never remounts the page.
  const bar = !canWrite ? <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><View style={{ flex: 1 }}><LockedAction label="Needs a doctor to write the note" path="note.save" height={48} /></View></View>
    // The judge build with nothing recorded: no transcript, so no draft; the way in is the recorder.
    : !hasContent && from === "nothing" ? <>
      <StateLine>Nothing recorded yet, so there is nothing to draft from. Record the consultation, then review the note Sona drafts from it.</StateLine>
      <Action label="Open consultation" icon="waveform" onPress={() => { haptic("tap"); router.push("/recording"); }} />
    </>
    : !hasContent ? suggestionBlocked ? <StateLine>{suggestionBlocked}</StateLine> : <>
      <Action label={drafting ? "Drafting from consultation…" : "Draft from consultation"} icon="waveform" disabled={drafting} onPress={draftNote} />
      <SampleLabel source={encounter.transcript.length ? undefined : "fixture"} what="scribe" />
    </> : <>
    <View accessible accessibilityLiveRegion="polite" accessibilityLabel={state.title} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 }}>
      <Animated.View key={state.title} entering={reducedMotion ? undefined : riseIn({ distance: 0, scale: 0.8, duration: 240 })}>
        <Animated.View style={{ animationName: saving && !reducedMotion ? SPIN : undefined, animationDuration: 1000, animationIterationCount: "infinite", animationTimingFunction: "linear" }}>
          <Icon name={state.icon} size={16} color={state.color} />
        </Animated.View>
      </Animated.View>
      <Text numberOfLines={2} style={{ ...type.footnote, flex: 1, fontWeight: "500", color: status === "failed" ? palette.amber : palette.ink }}>{state.title}</Text>
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ flex: 1 }}><Action label={saving ? "Saving…" : status === "failed" ? "Retry save" : "Save draft"} accessibilityLabel={status === "failed" ? "Retry saving draft" : undefined} icon="checkmark" disabled={saving} onPress={save} /></View>
      <View style={{ flex: 1 }}><Action label={encounter.noteReviewed ? "Reviewed" : "Mark reviewed"} accessibilityLabel={encounter.noteReviewed ? "Marked reviewed" : "Mark note reviewed"} secondary disabled={encounter.noteReviewed || saving || status !== "saved"} onPress={() => { Keyboard.dismiss(); haptic("done"); updateEncounter(current => ({ ...current, noteReviewed: true })); }} /></View>
    </View>
    {next && <QuietLink label={`Next: ${next.label}`} icon="arrow.right.circle" onPress={() => { haptic("tap"); router.push(next.op.slice(3) as never); }} />}
    {live && <Pressable accessibilityRole="switch" accessibilityLabel="Exclude this note from training" accessibilityHint="When on, saving keeps this visit's note out of the de-identified training data" accessibilityState={{ checked: excludeFromTraining }}
      onPress={() => setExcludeFromTraining(v => !v)} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 4 }}>
      <Text style={{ ...type.footnote, flex: 1, color: palette.muted }}>Exclude from training</Text>
      <Switch value={excludeFromTraining} onValueChange={setExcludeFromTraining} trackColor={{ true: palette.blue }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
    </Pressable>}
  </>;

  // No keyboard avoiding: while typing, the bar stays under the keyboard and the scroll view keeps the caret above it.
  return <Screen bottom={bar}>
    <Animated.View entering={rise(0)} style={{ gap: 12 }}>
      <Insight eyebrow={patient.name}>{encounter.noteReviewed ? <Tone of="good">Reviewed</Tone> : !hasContent ? "Nothing drafted yet" : <>Draft{emptyLine ? <> · <Tone of="soon">{emptyLine}</Tone></> : null} · not reviewed</>}</Insight>
      <Text selectable style={{ ...type.footnote, lineHeight: 19, color: palette.muted }}>{live ? "Verify drafts against source." : "Verify drafts against source · local session only, no record connected."}</Text>
      {/* A note drafted from the scripted sample stays labelled until the clinician marks it reviewed; so does a live draft, by its origin. */}
      {hasContent && encounter.noteFromSample && !encounter.noteReviewed && <SampleLabel source="fixture" what="scribe" />}
      {hasContent && liveDraft && !encounter.noteFromSample && !encounter.noteReviewed && <SampleLabel source={liveDraft.source} model={liveDraft.model} waking={liveDraft.waking} rule what="scribe" />}
      {liveDraft?.error && !encounter.noteReviewed && <StateLine warning>{`Sona couldn't draft this note (${liveDraft.error}), so it holds the consultation as captured.`}</StateLine>}
      {!!liveDraft?.dropped && !encounter.noteReviewed && <StateLine>{`Sona left out ${liveDraft.dropped} ${liveDraft.dropped === 1 ? "statement" : "statements"} it couldn't check against the transcript.`}</StateLine>}
      {unsure > 0 && <StateLine warning>{`${unsure} ${unsure === 1 ? "turn has" : "turns have"} an unsure speaker.`}</StateLine>}
      {unsure > 0 && <QuietLink label="Check speakers" icon="person.2" onPress={() => { haptic("tap"); router.push("/recording"); }} />}
      {missing.length > 0 && <StateLine warning>{`${failedLine(missing)} Not in this draft.`}</StateLine>}
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
        <Text selectable style={{ ...type.footnote, lineHeight: 19, color: palette.muted }}>{liveDraft?.source === "model" && (key === "assessment" || key === "plan") ? "Drafted by Sona only from what you said in the consultation · yours to confirm." : framing[key]}</Text>
        {sources[key] && <SourceLink label={key === "subjective" ? "Review consultation / history source" : "Review observation source"} onPress={() => router.push({ pathname: "/source", params: { id: sources[key]!, patientId: patient.id } })} />}
      </Expand>}
      <Surface style={{ paddingHorizontal: 16, paddingVertical: 14, borderRadius: radius.group, borderColor: focused === key ? FOCUS : glass.rim, transitionProperty: "borderColor", transitionDuration: 160 } as never}>
        <TextInput accessibilityLabel={`Clinical note ${key}`} editable={canWrite} value={sections[key]} onChangeText={value => editSection(key, value)} onFocus={() => setFocused(key)} onBlur={() => setFocused(current => current === key ? undefined : current)} multiline placeholder={placeholders[key]} placeholderTextColor={palette.placeholder} textAlignVertical="top"
          style={{ minHeight: key === "subjective" ? 150 : 96, padding: 0, fontSize: type.body.fontSize, lineHeight: 25, color: palette.ink }} />
      </Surface>
    </Animated.View>)}

    <Animated.View entering={rise(5)} layout={layout} style={{ gap: 10 }}>
      {/* An empty note's bar holds its way in, or why it waits. */}
      {!canWrite || !hasContent || from === "nothing" ? null : suggestionBlocked ? <StateLine>{suggestionBlocked}</StateLine>
        : !suggestion && <QuietLink label={drafting ? "Drafting from consultation…" : "Fresh draft from consultation"} icon="doc.text.magnifyingglass" onPress={() => { if (drafting) return; if (fromRecording) return void draftLive(true); haptic("tap"); setSuggestion(readNoteSections(buildDraft(consultation))); }} />}
      {suggestion && <Expand key="suggestion">
        <Surface style={{ padding: 18, gap: 14 }}>
          <Text style={{ ...type.caption, fontWeight: "600", letterSpacing: 0.3, color: palette.blue }}>New suggestion · not applied · your note stays until you replace it</Text>
          {offered && <SampleLabel source={offered.source} model={offered.model} waking={offered.waking} rule what="scribe" />}
          {sectionKeys.map(key => <View key={key} style={{ gap: 3 }}>
            <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>{noteMeta[key].title}</Text>
            <Text selectable style={{ ...type.callout, lineHeight: 22, color: suggestion[key].trim() ? palette.ink : palette.muted }}>{suggestion[key].trim() || "Left empty for you"}</Text>
          </View>)}
          <Action label="Replace note with this suggestion" onPress={() => { haptic("done"); if (pendingDraft.current) applyDraft(patient.id, pendingDraft.current, updateEncounter); else updateEncounter(current => editNote(current, suggestion, !current.transcript.length)); pendingDraft.current = undefined; setSuggestion(undefined); }} />
          <Action label="Keep current note" secondary onPress={() => { pendingDraft.current = undefined; setSuggestion(undefined); }} />
        </Surface>
      </Expand>}
    </Animated.View>

    {showDemoControls && <Animated.View entering={rise(6)} layout={layout} style={{ gap: 12 }}>
      <View style={{ flexDirection: "row" }}><Chip label="Prototype controls" expanded={prototype} onPress={() => setPrototype(value => !value)} /></View>
      {prototype && <Expand key="prototype" style={{ gap: 10 }}>
        <Action label={failNextSave ? "Next save will fail · cancel simulation" : "Simulate failure on next save"} secondary disabled={saving} onPress={() => setFailNextSave(value => !value)} />
      </Expand>}
    </Animated.View>}
  </Screen>;
}
