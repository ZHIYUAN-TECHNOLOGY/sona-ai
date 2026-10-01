import { PressScale } from "@/components/sona/parts";
import { JSONUIProvider, Renderer, defineRegistry } from "@json-render/react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn } from "react-native-reanimated";
import { EdgeBlur } from "@/components/sona/edge-blur";
import { List, ListRow, QuestionList } from "@/components/sona/list";
import { Drafting, MODEL_SLOW, SampleLabel } from "@/components/sona/model-answer";
import { Text } from "@/components/sona/text";
import { palette, type, radius } from "@/components/sona/theme";
import { Action, Icon, Notice, RoundAction, Surface } from "@/components/sona/ui";
import { GlassOrb } from "@/components/sona/glass-orb";
import { OrbGlyph } from "@/components/sona/orb-glyph";
import { VoiceDock } from "@/features/encounter/voice-dock";
import { openSession } from "@/features/encounter/navigation";
import { useEncounter } from "@/features/encounter/store";
import { api, useLive } from "@/features/live";
import { startingReply, wakingOf } from "@/features/live/waking";
import { PLACEHOLDER, SCOPE_LABEL, askContext, matchQuestion, suggestion, type Answer, type Scope } from "./answers";
import { askCatalog, validateAskSpec } from "./catalog";
import { SAVABLE, isSaved, saveView, useSaved } from "./saved";

/** Space a page leaves at the end of its content so the ask bar never covers it. */
export const ASK_SPACE = 132;
const tap = () => { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); };

type Ops = { run: (op: string) => void };
const OpsContext = createContext<Ops>({ run: () => {} });

/** A consequential action: what will happen, then Confirm; afterwards the receipt in its place. */
function Review({ title, items, what, confirm, done, op }: { title: string; items: string[]; what: string; confirm: string; done: string; op: string }) {
  const { run } = use(OpsContext);
  const [confirmed, setConfirmed] = useState(false);
  if (confirmed) return <Animated.View entering={FadeIn.duration(200)} style={{ flexDirection: "row", gap: 10, alignItems: "center", padding: 14, borderRadius: radius.group, backgroundColor: "rgba(15,110,102,0.10)" }}>
    <Icon name="checkmark.circle.fill" size={18} color={palette.green} />
    <Text style={{ ...type.subhead, flex: 1, fontWeight: "600", color: palette.ink }}>{done}</Text>
  </Animated.View>;
  return <Surface feature style={{ padding: 16, gap: 10 }}>
    <Text style={{ ...type.overline, color: palette.blue }}>Review before confirming</Text>
    <Text style={{ ...type.headline, color: palette.ink }}>{title}</Text>
    {items.map(item => <Text key={item} style={{ ...type.subhead, color: palette.ink }}>· {item}</Text>)}
    <Text style={{ ...type.footnote, color: palette.muted }}>{what}</Text>
    <Action label={confirm} onPress={() => { run(op); setConfirmed(true); }} />
  </Surface>;
}

const { registry } = defineRegistry(askCatalog, {
  components: {
    AskColumn: ({ children }) => <View style={{ gap: 14 }}>{children}</View>,
    AskLead: ({ props }) => <Text accessibilityRole="header" style={{ ...type.title, fontWeight: "600", color: palette.ink }}>{props.text}</Text>,
    AskRows: ({ props }) => { const { run } = use(OpsContext); return <List>
      {props.rows.map((r, i) => <ListRow key={r.id} title={r.title} detail={r.detail} tone={r.tone} divider={i > 0} onPress={r.op ? () => run(r.op!) : undefined} />)}
    </List>; },
    AskReview: ({ props }) => <Review {...props} />,
    AskActions: ({ props }) => { const { run } = use(OpsContext); return <View style={{ gap: 8 }}>{props.items.map(a => <Action key={a.op} label={a.label} secondary={!a.primary} onPress={() => run(a.op)} />)}</View>; },
  },
});

/**
 * The ops an answer may run, and nothing else: open a visit, go to a page, change the page's tab or
 * filter, or mark a task done (after the answer's review card). `leave` closes whatever shows the answer first.
 */
export function useRunOp(leave: () => void, onTab?: (tab: string) => void) {
  const { updateEncounter } = useEncounter();
  return (op: string) => {
    const [kind, ...rest] = op.split(":");
    const arg = rest.join(":");
    if (kind === "open") { leave(); setTimeout(() => openSession(arg), 250); }
    else if (kind === "go") { leave(); setTimeout(() => router.push(arg as never), 250); }
    else if (kind === "tab") { leave(); onTab?.(arg); }
    else if (kind === "task-done") { const [patientId, taskId] = rest; if (patientId && taskId) updateEncounter(current => ({ ...current, tasks: current.tasks.map(t => t.id === taskId ? { ...t, completed: true } : t) }), false, patientId); }
  };
}

/** Where a day-wide answer's page action leads: a Patients tab, or the ward filtered. */
export const openTab = (tab: string) => tab === "blocked" ? router.push({ pathname: "/ward", params: { filter: "blocked" } }) : router.push({ pathname: "/patients", params: { tab } });

/** An answer as a view from the ask catalogue, with its question and its label (rule-based, or the model that drafted it); nothing renders if the spec fails the checks. */
export function AnswerView({ answer, run, question = true, model }: { answer: Answer; run: (op: string) => void; question?: boolean; model?: string }) {
  const spec = validateAskSpec(answer.spec);
  if (!spec) return null;
  return <View style={{ gap: 14 }}>
    {question && <Text style={{ ...type.footnote, color: palette.muted }}>{answer.question}</Text>}
    <OpsContext value={{ run }}><JSONUIProvider initialState={{}}><Renderer spec={spec} registry={registry} includeStandard={false} /></JSONUIProvider></OpsContext>
    {model ? <SampleLabel source="model" model={model} /> : <SampleLabel source="fixture" rule />}
  </View>;
}

/**
 * Live mode: a question the page's rules don't answer goes to the model (ask.free) with the page's own
 * data; the server sends a spec only if it stays on that data. No `answer` means no model answer (demo
 * mode, fixture, or a failed call), so the sheet keeps saying what it can answer here, or, with `waking`,
 * that the model is starting and when to ask again, or, `unanswered`, that the model found no answer on the page.
 */
function useFreeAnswer(scope: Scope, question: string | undefined, answers: Answer[]) {
  const { on } = useLive();
  const [state, setState] = useState<{ question: string; thinking: boolean; answer?: Answer; model?: string; waking?: number; unanswered?: boolean }>();
  useEffect(() => {
    if (!on || !question) return;
    let current = true;
    setState({ question, thinking: true });
    api.ask.free({ scope, question, context: askContext(answers) }).then(r => r.source === "model" ? { answer: { id: "free", question, spec: r.spec as Answer["spec"], worth: true }, model: r.model }
      : { waking: wakingOf(r), unanswered: "unanswered" in r && r.unanswered }, () => ({})).then(r => {
      if (current) setState({ question, thinking: false, ...r });
    });
    return () => { current = false; };
  }, [on, question]); // eslint-disable-line react-hooks/exhaustive-deps
  return on && state?.question === question ? state : undefined;
}

/** Which answer the sheet shows (or a question it couldn't answer), for a page that opens it itself. */
export type AskState = { open: boolean; shown?: Answer; missed?: string };
export const closed: AskState = { open: false };

/**
 * The page-scoped sheet ("Ward 4B"): the chosen answer as a view from the ask catalogue, the page's
 * other questions, and a field that matches a typed question to them. `onTab` lets an answer change the page.
 */
export function AskSheet({ scope, answers, state, onChange, onTab }: { scope: Scope; answers: Answer[]; state: AskState; onChange: (s: AskState) => void; onTab?: (tab: string) => void }) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const { shown, missed } = state;
  const free = useFreeAnswer(scope, missed, answers);
  const close = () => onChange(closed);
  const ask = () => { const q = text.trim(); if (!q) return; const a = matchQuestion(q, answers); setText(""); onChange(a ? { open: true, shown: a } : { open: true, missed: q }); };
  const run = useRunOp(close, onTab);
  const saved = useSaved();
  const others = answers.filter(a => a.id !== shown?.id);

  return <Modal visible={state.open} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: palette.canvas }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 16, paddingBottom: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: palette.blueWash }}>
          <Text style={{ ...type.caption, color: palette.blue }}>✦</Text><Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>{SCOPE_LABEL[scope]}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} hitSlop={10} style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(20,28,40,0.06)" }}><Icon name="xmark" size={14} color={palette.ink} /></Pressable>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        {missed && (free?.thinking ? <Drafting label="Thinking…" lines={2} slow={MODEL_SLOW} />
          : free?.answer ? <AnswerView answer={free.answer} run={run} model={free.model} />
          : free?.unanswered ? <Text style={{ ...type.callout, color: palette.muted }}>“{missed}”: Sona couldn't answer that from this page.</Text>
          : <Text style={{ ...type.callout, color: palette.amber }}>“{missed}”: {free?.waking ? startingReply(free.waking) : "Sona answers only these questions here until the model is switched on."}</Text>)}
        {shown ? <View style={{ gap: 14 }}>
          <AnswerView answer={shown} run={run} />
          {/* A day-wide answer can leave the sheet: as its own page, or kept in the sidebar where it stays live. */}
          {SAVABLE.has(shown.id) && <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}><Action label="Open as page" icon="arrow.up.left.and.arrow.down.right" secondary onPress={() => { close(); setTimeout(() => router.push({ pathname: "/view/[id]", params: { id: shown.id } }), 250); }} /></View>
            <View style={{ flex: 1 }}><Action label={isSaved(saved, shown.id) ? "Saved" : "Save to sidebar"} icon={isSaved(saved, shown.id) ? "checkmark" : "pin"} secondary disabled={isSaved(saved, shown.id)} onPress={() => { tap(); saveView({ id: shown.id, question: shown.question }); }} /></View>
          </View>}
        </View> : <View style={{ gap: 10 }}>
          <Text style={{ ...type.title, fontWeight: "600", color: palette.ink }}>Ask Sona</Text>
          <Text style={{ ...type.subhead, color: palette.muted }}>Answers are built from this page's own data and can act on it.</Text>
        </View>}
        <QuestionList questions={others.map(a => ({ key: a.id, text: a.question }))} onAsk={id => { const a = others.find(x => x.id === id); if (a) onChange({ open: true, shown: a }); }} />
      </ScrollView>
      {/* The composer sits at the bottom, like every chat, and rides up with the keyboard. */}
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 12), borderTopWidth: 1, borderColor: "rgba(20,28,40,0.06)", backgroundColor: palette.canvas }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 24, backgroundColor: palette.surface, paddingLeft: 10, paddingRight: 6, boxShadow: "0 4px 14px rgba(30,50,90,0.08)" }}>
          <TextInput accessibilityLabel="Ask Sona" placeholder={PLACEHOLDER[scope]} value={text} onChangeText={setText} onSubmitEditing={ask} returnKeyType="send" placeholderTextColor={palette.placeholder} style={{ flex: 1, minHeight: 48, fontSize: type.body.fontSize, color: palette.ink }} />
          <RoundAction icon="send" label="Send" ready={!!text.trim()} onPress={ask} />
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

/**
 * Sona on a page: the same dock as Today and a visit (tap or hold the orb to talk, the keyboard to
 * type), carrying the page's ✦ suggestion. What is asked opens the page-scoped sheet. The dock
 * captures the page behind it for the hold-to-talk veil, so the page goes in as children; a fade
 * behind the dock keeps the end of the page readable.
 */
export function WithSona({ scope, answers, onTab, hidden = false, children }: { scope: Scope; answers: Answer[]; onTab?: (tab: string) => void; hidden?: boolean; children: ReactNode }) {
  const { voiceInput } = useEncounter();
  const backdrop = useRef<View>(null);
  const [state, setState] = useState<AskState>(closed);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string>();
  const nudge = suggestion(answers);
  const submit = (text: string) => { const q = text.trim(); if (!q) return; setDraft(""); setNotice(undefined); const a = matchQuestion(q, answers); setState(a ? { open: true, shown: a } : { open: true, missed: q }); };
  return <View style={{ flex: 1 }}>
    <View ref={backdrop} collapsable={false} style={{ flex: 1 }}>{children}</View>
    {!hidden && <EdgeBlur edge="bottom" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 100 }} />}
    {!hidden && <VoiceDock backdrop={backdrop} onSubmit={submit} onCancel={() => {}} placeholder={PLACEHOLDER[scope]} draft={draft} onDraft={value => { setDraft(value); setNotice(undefined); }}
      // The voice sample says the page's suggested question, so talking works the same as tapping it.
      spokenPrompt={nudge?.answer.question ?? answers[0]?.question ?? "What needs me now?"}
      voiceEnabled={voiceInput} onVoiceDisabled={() => setNotice("Voice input is turned off in Settings. Type your question instead.")} onVoiceError={setNotice}
      suggestion={nudge && { text: nudge.text, onPress: () => setState({ open: true, shown: nudge.answer }) }}
      above={notice && <Notice>{notice}</Notice>} />}
    <AskSheet scope={scope} answers={answers} state={state} onChange={setState} onTab={onTab} />
  </View>;
}

/**
 * Sona beside a review page's pinned decision (Discharge, the GL, X-ray), where the dock would cover
 * the decision: the dock's own orb, smaller, opening the page-scoped sheet with the page's answer.
 */
export function AskOrb({ scope, answers }: { scope: Scope; answers: Answer[] }) {
  const [state, setState] = useState<AskState>(closed);
  const nudge = answers.find(a => a.worth);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`Ask Sona about ${SCOPE_LABEL[scope].toLowerCase()}`} accessibilityHint={nudge?.question} onPress={() => { tap(); setState({ open: true, shown: nudge ?? answers[0] }); }}
    >{({ pressed }) => <PressScale pressed={pressed} style={{ width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: palette.white, boxShadow: "0 6px 18px rgba(40,70,140,0.2)" }}>
      <View style={{ position: "absolute", inset: 0 }}><GlassOrb size={52} energy={0} still /></View>
      <OrbGlyph activity="idle" still />
    </PressScale>}</Pressable>
    <AskSheet scope={scope} answers={answers} state={state} onChange={setState} />
  </>;
}
