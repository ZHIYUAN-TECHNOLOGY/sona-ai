import { JSONUIProvider, Renderer, defineRegistry } from "@json-render/react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { createContext, use, useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { SampleLabel } from "@/components/sona/model-answer";
import { SonaMark } from "@/components/sona/orb";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, Glass, Icon, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { openSession } from "@/features/encounter/navigation";
import { useEncounter } from "@/features/encounter/store";
import { PLACEHOLDER, SCOPE_LABEL, matchQuestion, type Answer, type Scope } from "./answers";
import { askCatalog, validateAskSpec } from "./catalog";

/** Space a page leaves at the end of its content so the ask bar never covers it. */
export const ASK_SPACE = 92;
const TONE = { urgent: palette.red, soon: palette.amber, good: palette.green, calm: palette.muted } as const;
const tap = () => { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); };

type Ops = { run: (op: string) => void };
const OpsContext = createContext<Ops>({ run: () => {} });

/** A consequential action: what will happen, then Confirm; afterwards the receipt in its place. */
function Review({ title, items, what, confirm, done, op }: { title: string; items: string[]; what: string; confirm: string; done: string; op: string }) {
  const { run } = use(OpsContext);
  const [confirmed, setConfirmed] = useState(false);
  if (confirmed) return <Animated.View entering={FadeIn.duration(200)} style={{ flexDirection: "row", gap: 10, alignItems: "center", padding: 14, borderRadius: 18, backgroundColor: "rgba(15,110,102,0.10)" }}>
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
    AskRows: ({ props }) => { const { run } = use(OpsContext); return <Surface style={{ paddingVertical: 4 }}>
      {props.rows.map((r, i) => { const content = <>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: TONE[r.tone] }} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>{r.title}</Text>
          <Text numberOfLines={2} style={{ ...type.caption, color: r.tone === "calm" ? palette.muted : TONE[r.tone] }}>{r.detail}</Text>
        </View>
        {r.op && <Icon name="chevron.right" size={11} color={palette.muted} />}
      </>;
        const style = { minHeight: 52, flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderColor: "rgba(20,28,40,0.06)" };
        return r.op ? <Pressable key={r.id} accessibilityRole="button" accessibilityLabel={`${r.title}, ${r.detail}`} onPress={() => run(r.op!)} style={({ pressed }) => ({ ...style, opacity: pressed ? 0.6 : 1 })}>{content}</Pressable>
          : <View key={r.id} accessible accessibilityLabel={`${r.title}, ${r.detail}`} style={style}>{content}</View>; })}
    </Surface>; },
    AskReview: ({ props }) => <Review {...props} />,
    AskActions: ({ props }) => { const { run } = use(OpsContext); return <View style={{ gap: 8 }}>{props.items.map(a => <Action key={a.op} label={a.label} secondary={!a.primary} onPress={() => run(a.op)} />)}</View>; },
  },
});

/** The page's ✦ suggestion: shown only when its answer has something, one tap opens it. */
export function AskNudge({ answer, onPress }: { answer: Answer; onPress: () => void }) {
  const { reducedMotion } = useAccessibleEffects();
  return <Animated.View entering={reducedMotion ? undefined : FadeIn.delay(250).duration(300)} style={{ alignSelf: "flex-start" }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Ask Sona: ${answer.question}`} onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.9)", boxShadow: "0 4px 14px rgba(36,91,204,0.16)", transform: [{ scale: pressed ? 0.96 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
      <Text style={{ fontSize: 13, color: palette.blue }}>✦</Text><Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>{answer.question}</Text>
    </Pressable>
  </Animated.View>;
}

/** Which answer the sheet shows (or a question it couldn't answer), for a page that opens it itself. */
export type AskState = { open: boolean; shown?: Answer; missed?: string };
export const closed: AskState = { open: false };

/**
 * The page-scoped sheet ("Ward 4B"): the chosen answer as a view from the ask catalogue, the page's
 * other questions, and a field that matches a typed question to them. `onTab` lets an answer change the page.
 */
export function AskSheet({ scope, answers, state, onChange, onTab }: { scope: Scope; answers: Answer[]; state: AskState; onChange: (s: AskState) => void; onTab?: (tab: string) => void }) {
  const { updateEncounter } = useEncounter();
  const [text, setText] = useState("");
  const { shown, missed } = state;
  const close = () => onChange(closed);
  const ask = () => { const q = text.trim(); if (!q) return; const a = matchQuestion(q, answers); setText(""); onChange(a ? { open: true, shown: a } : { open: true, missed: q }); };
  // The ops an answer may run; anything else is ignored.
  const run = (op: string) => {
    const [kind, ...rest] = op.split(":");
    const arg = rest.join(":");
    if (kind === "open") { close(); setTimeout(() => openSession(arg), 250); }
    else if (kind === "go") { close(); setTimeout(() => router.push(arg as never), 250); }
    else if (kind === "tab") { close(); onTab?.(arg); }
    else if (kind === "task-done") { const [patientId, taskId] = rest; if (patientId && taskId) updateEncounter(current => ({ ...current, tasks: current.tasks.map(t => t.id === taskId ? { ...t, completed: true } : t) }), false, patientId); }
  };
  const spec = shown ? validateAskSpec(shown.spec) : null;
  const others = answers.filter(a => a.id !== shown?.id);

  return <Modal visible={state.open} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 16, paddingBottom: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: palette.blueWash }}>
          <Text style={{ fontSize: 12, color: palette.blue }}>✦</Text><Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>{SCOPE_LABEL[scope]}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} hitSlop={10} style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(20,28,40,0.06)" }}><Icon name="xmark" size={14} color={palette.ink} /></Pressable>
      </View>
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 22, backgroundColor: palette.surface, paddingLeft: 14, paddingRight: 6 }}>
          <TextInput accessibilityLabel="Ask Sona" placeholder={PLACEHOLDER[scope]} value={text} onChangeText={setText} onSubmitEditing={ask} returnKeyType="send" placeholderTextColor={palette.muted} style={{ flex: 1, minHeight: 46, fontSize: 16, color: palette.ink }} />
          <Pressable accessibilityRole="button" accessibilityLabel="Send" disabled={!text.trim()} onPress={ask} style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: text.trim() ? palette.dark : "rgba(20,28,40,0.1)" }}><Icon name="arrow.up" size={15} color={palette.white} /></Pressable>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {missed && <Text style={{ ...type.callout, color: palette.amber }}>“{missed}”: Sona answers only these questions here until the model is switched on.</Text>}
        {spec ? <View style={{ gap: 14 }}>
          <Text style={{ ...type.footnote, color: palette.muted }}>{shown!.question}</Text>
          <OpsContext value={{ run }}><JSONUIProvider initialState={{}}><Renderer spec={spec} registry={registry} includeStandard={false} /></JSONUIProvider></OpsContext>
          <SampleLabel source="fixture" rule />
        </View> : <View style={{ gap: 10 }}>
          <Text style={{ ...type.title, fontWeight: "600", color: palette.ink }}>Ask Sona</Text>
          <Text style={{ ...type.subhead, color: palette.muted }}>Answers are built from this page's own data and can act on it.</Text>
        </View>}
        {others.length > 0 && <Surface style={{ paddingVertical: 4 }}>
          {others.map((a, i) => <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={a.question} onPress={() => { tap(); onChange({ open: true, shown: a }); }}
            style={({ pressed }) => ({ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, borderTopWidth: i ? 1 : 0, borderColor: "rgba(20,28,40,0.06)", opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ fontSize: 13, color: palette.blue }}>✦</Text><Text style={{ ...type.callout, flex: 1, color: palette.ink }}>{a.question}</Text>
          </Pressable>)}
        </Surface>}
      </ScrollView>
    </View>
  </Modal>;
}

/**
 * Sona on a page without the voice dock: a glass ask bar at the bottom with the page's ✦ suggestion,
 * opening the page-scoped sheet. Answers come from the app's rules over its own data, labelled so;
 * free questions wait for the model.
 */
export function AskBar({ scope, answers, onTab }: { scope: Scope; answers: Answer[]; onTab?: (tab: string) => void }) {
  const [state, setState] = useState<AskState>(closed);
  const nudge = answers.find(a => a.worth);
  return <>
    <View pointerEvents="box-none" style={{ position: "absolute", left: 16, right: 16, bottom: 28, gap: 8 }}>
      {nudge && <AskNudge answer={nudge} onPress={() => setState({ open: true, shown: nudge })} />}
      <Pressable accessibilityRole="button" accessibilityLabel={`Ask Sona about ${SCOPE_LABEL[scope].toLowerCase()}`} onPress={() => { tap(); setState({ open: true }); }}>
        <Glass style={{ height: 52, borderRadius: 26, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14 }}>
          <SonaMark size={22} /><Text style={{ ...type.callout, flex: 1, color: palette.muted }}>{PLACEHOLDER[scope]}</Text>
        </Glass>
      </Pressable>
    </View>
    <AskSheet scope={scope} answers={answers} state={state} onChange={setState} onTab={onTab} />
  </>;
}
