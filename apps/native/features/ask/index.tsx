import { JSONUIProvider, Renderer, defineRegistry } from "@json-render/react-native";
import * as Haptics from "expo-haptics";
import { router, useNavigation } from "expo-router";
import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn } from "react-native-reanimated";
import { EdgeBlur } from "@/components/sona/edge-blur";
import { List, ListRow } from "@/components/sona/list";
import { SampleLabel } from "@/components/sona/model-answer";
import { Text } from "@/components/sona/text";
import { palette, type, radius } from "@/components/sona/theme";
import { Action, Icon, IconButton, Notice, Surface } from "@/components/sona/ui";
import { VoiceDock } from "@/features/encounter/voice-dock";
import type { LiveAdapter } from "@/features/encounter/sona-live";
import type { Attachment } from "@/components/sona/attachments-menu";
import { carry } from "@/features/encounter/carry";
import { openSession } from "@/features/encounter/navigation";
import { useEncounter } from "@/features/encounter/store";
import { api, useLive } from "@/features/live";
import { startingReply, wakingOf } from "@/features/live/waking";
import { PLACEHOLDER, SCOPE_LABEL, askContext, forWhichPatient, matchQuestion, suggestion, type Answer, type Scope } from "./answers";
import { askCatalog, validateAskSpec } from "./catalog";
import { SAVABLE, isSaved, saveView, useSaved } from "./saved";
import { answerOf, type Entry, type Reply } from "./thread";
import { ThreadEntry } from "./today-thread";

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

const only = (answers: Answer[]) => `Until the model is switched on, Sona answers only: ${answers.map(a => a.question).join(" · ")}`;
/** What a page says to a question without a model: its rule answer, or (demo mode) what Sona answers here; undefined when the model should answer. */
export function answerNow(question: string, answers: Answer[], live: boolean): Reply | undefined {
  const rule = matchQuestion(question, answers);
  return rule ? { answer: rule } : live ? undefined : { notice: only(answers) };
}
/** Live mode: the model's answer from the page's own data (ask.free), or why not: it is starting or out of reach (ask again), or the page has no answer. */
export async function answerFree(scope: Scope, question: string, answers: Answer[]): Promise<Reply> {
  try {
    const r = await api.ask.free({ scope, question, context: askContext(answers) });
    if (r.source === "model") return { answer: { id: "free", question, spec: r.spec as Answer["spec"], worth: true }, model: r.model };
    const waking = wakingOf(r);
    return waking ? { notice: startingReply(waking), again: true } : { notice: "unanswered" in r && r.unanswered ? "Sona couldn't answer that from this page." : only(answers) };
  } catch {
    return { notice: "Sona couldn't reach the model. Ask again.", again: true };
  }
}

/** A day-wide answer can leave the sheet or Today's thread: as its own page, or kept in the sidebar where it stays live. `leave` closes what shows it first. */
export function KeepRow({ answer, leave }: { answer: Answer; leave: () => void }) {
  const saved = useSaved(), kept = isSaved(saved, answer.id);
  if (!SAVABLE.has(answer.id)) return null;
  return <View style={{ flexDirection: "row", gap: 8 }}>
    <View style={{ flex: 1 }}><Action label="Open as page" icon="arrow.up.left.and.arrow.down.right" secondary onPress={() => { leave(); setTimeout(() => router.push({ pathname: "/view/[id]", params: { id: answer.id } }), 250); }} /></View>
    <View style={{ flex: 1 }}><Action label={kept ? "Saved" : "Save to sidebar"} icon={kept ? "checkmark" : "pin"} secondary disabled={kept} onPress={() => { tap(); saveView({ id: answer.id, question: answer.question }); }} /></View>
  </View>;
}

/**
 * Sona on a page (Ward, Messages, Tasks, Patients…), the same shell as Today and a visit: the page, then the bar
 * ([+] [mic] [keyboard]) with the page's ✦ suggestion above it. What is asked (typed, spoken, or the ✦) starts the page's
 * conversation in place of its content, read as Today's is (the question's bubble, the lead inked in, the answer and its
 * ops); New conversation in the header, or an op that changes the page (a filter), brings the page back. A rule answer
 * lands at once; live, the model answers from the page's own data; demo mode says what Sona answers here.
 */
export function WithSona({ scope, answers, onTab, hidden = false, children }: { scope: Scope; answers: Answer[]; onTab?: (tab: string) => void; hidden?: boolean; children: ReactNode }) {
  const { voiceInput, patients } = useEncounter();
  const { on } = useLive();
  const navigation = useNavigation();
  const [pending, setPending] = useState<Attachment[]>([]);
  const backdrop = useRef<View>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const next = useRef(0);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string>();
  const [dockH, setDockH] = useState(130);
  const talking = entries.length > 0, newest = entries.at(-1);
  const nudge = suggestion(answers);
  const reply = (id: number, r?: Reply) => setEntries(list => list.map(e => (e.id === id ? { id, question: e.question, ...(r && { reply: r }) } : e)));
  const settle = async (id: number, question: string) => reply(id, await answerFree(scope, question, answers));
  /** `rule`: the answer when the question is a known one (the ✦), so it never rests on matching its words. Attachments
   * have no reader on these pages: Sona asks whose they are, and the visit picked has them waiting (./encounter/carry). */
  const ask = (question: string, rule?: Answer) => {
    if (!rule && pending.length) { carry(pending); setPending([]); rule = forWhichPatient(question, patients); }
    const now = rule ? { answer: rule } : answerNow(question, answers, on), id = next.current++;
    setEntries(list => [...list, { id, question, ...(now && { reply: now }) }]);
    if (!now) void settle(id, question);
  };
  const clear = () => setEntries([]);
  // An op that changes the page (Ward's blocked beds) shows the page: the conversation steps aside.
  const tab = onTab && ((t: string) => { clear(); onTab(t); });
  const submit = (text: string) => { const q = text.trim(); if (!q) return; setDraft(""); setNotice(undefined); ask(q); };
  // Sona Live is the page's voice: a spoken question joins the conversation as a typed one does.
  const sonaLive: LiveAdapter = { scope: SCOPE_LABEL[scope], ask: async question => { ask(question); return { shown: true }; } };
  // New conversation sits in the page's header while there is one.
  useEffect(() => {
    navigation.setOptions({ headerRight: talking ? () => <IconButton name="plus.bubble" label="New conversation" onPress={clear} /> : undefined });
  }, [talking]); // eslint-disable-line react-hooks/exhaustive-deps
  return <View style={{ flex: 1 }}>
    <View ref={backdrop} collapsable={false} style={{ flex: 1 }}>
      {talking ? <PageConversation entries={entries} bottom={dockH + 32} onAgain={e => { reply(e.id); void settle(e.id, e.question); }} onTab={tab} /> : children}
    </View>
    {/* What passes under the dock and its ✦ blurs and fades into the canvas, as tall a band as Today's, so the chip reads over a calm edge. */}
    {!hidden && <>
      <EdgeBlur edge="bottom" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: dockH + 36 }} />
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: dockH + 36, experimental_backgroundImage: "linear-gradient(180deg, rgba(245,246,248,0) 0%, rgba(245,246,248,0.78) 45%, rgba(245,246,248,0.94) 100%)" }} />
    </>}
    {!hidden && <VoiceDock backdrop={backdrop} sonaLive={sonaLive} onSubmit={submit} onCancel={() => {}} placeholder={PLACEHOLDER[scope]} draft={draft} onDraft={value => { setDraft(value); setNotice(undefined); }}
      // The voice sample says the page's suggested question, so talking works the same as tapping it.
      spokenPrompt={nudge?.answer.question ?? answers[0]?.question ?? "What needs me now?"}
      voiceEnabled={voiceInput} onVoiceDisabled={() => setNotice("Voice input is turned off in Settings. Type your question instead.")} onVoiceError={setNotice}
      // The ✦ asks into the conversation too; it steps aside while the newest answer already is it.
      suggestion={nudge && answerOf(newest)?.id !== nudge.answer.id ? { text: nudge.text, onPress: () => ask(nudge.answer.question, nudge.answer) } : undefined}
      attachments={pending} onAttachmentsChange={setPending} onHeight={setDockH} above={notice && <Notice>{notice}</Notice>} />}
  </View>;
}

/** A page's conversation, laid out as Today's: each newest question, and its answer once it lands, is brought into view. */
function PageConversation({ entries, bottom, onAgain, onTab }: { entries: Entry[]; bottom: number; onAgain: (entry: Entry) => void; onTab?: (tab: string) => void }) {
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollView>(null), brought = useRef("");
  const newest = entries.at(-1);
  return <ScrollView ref={scroll} style={{ flex: 1, backgroundColor: palette.canvas }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive"
    contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 64, paddingBottom: bottom, gap: 44 }}>
    {entries.map(entry => <View key={entry.id} collapsable={false} onLayout={e => {
      const key = `${entry.id}${entry.reply ? "+" : ""}`;
      if (entry.id === newest?.id && brought.current !== key) { brought.current = key; scroll.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - 8), animated: true }); }
    }}><ThreadEntry entry={entry} fresh={entry.id === newest?.id} onAgain={() => onAgain(entry)} onTab={onTab} /></View>)}
  </ScrollView>;
}
