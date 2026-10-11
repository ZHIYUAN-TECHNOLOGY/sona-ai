import { useMutation } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, Keyboard, Pressable, ScrollView, Share, View, type TextInput as RNTextInput } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { Easing, FadeIn, FadeInDown, useReducedMotion, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { answer, conditionOf, doctorQuestion, historyOf, leadOf, shown, spoken, startingLine, suggestions, urgent, wantsDoctor, type Reply } from "@/features/assistant/answers";
import { CHAT_AGENT_ON, replyOf, type CareChat } from "@/features/assistant/agent-replies";
import { tFor, useLang, useT } from "@/lib/i18n";
import { Composer } from "@/features/assistant/composer";
import { Icon, type IconName } from "@/lib/icons";
import { Dictation, MicButton } from "@/features/assistant/mic";
import { SUGGEST_ICON, SuggestionRow, VoiceMode, type Suggestion } from "@/features/assistant/voice";
import { Marked } from "@/features/assistant/marked";
import { Action, AnswerCards, DoctorCard, Done, newRequestId } from "@/features/assistant/answer-cards";
import { medicinesOf } from "@/features/assistant/terms";
import { useListen } from "@/lib/listen";
import { useNextDose, useNow } from "@/features/doses";
import { errorText } from "@/features/errors";
import { dayLabel, nextVisit } from "@/features/follow-ups/lines";
import { useFollowUps } from "@/features/follow-ups/row";
import { useMe } from "@/features/me";
import { saveQuestion } from "@/features/questions";
import { orbPad, SonaOrb } from "@/lib/orb";
import { VoiceOrb } from "@/lib/voice-orb";
import { AnimatedText, Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { AccentText, Call999, CircleButton, LoadError } from "@/lib/ui";
import { useDischarge } from "@/features/discharge/row";
import { client, orpc, queryClient } from "@/utils/orpc";

// Required only with the flag on, so a build without it never runs the chat SDK's modules.
const CareChatLink: typeof import("@/features/assistant/chat-agent").CareChatLink | undefined = CHAT_AGENT_ON ? require("@/features/assistant/chat-agent").CareChatLink : undefined;

/**
 * Ask Sona Care (the AI Health Companion kit's "Ask Nomi"), a full screen from the orb in the dock.
 * Empty: the orb, "Ask Sona Care" in the headline gradient, one faint line, then up to three questions
 * from the plan plus "Find a doctor for my …" as plain rows with a small icon, and the composer card
 * (voice mode until there is text, then send). Asked: the question in a white capsule on the right, and
 * Sona's answer as plain text on the canvas, in body weight with only its marked words bold, with where it came from, copy / helpful
 * / not helpful, and the next steps (Save for my visit, Ask my care team). While it works, a status line
 * sits by a small live orb for as long as the call runs. Any question is answered (care.ask): their own care
 * from their plan, anything else from general knowledge, marked as such; doctor questions search the hospital's
 * directory (care.doctors.list), and warning words put the 999 line first. A problem they report reaches their care
 * team (care.ask makes the task), and Sona's line saying so closes the answer. Each question goes with the chat's last
 * 6 turns (historyOf), typed or spoken, so a follow-up ("How does it help?") is read with them. + starts a new chat,
 * empty (nothing is stored, so no history button).
 */
type Turn = { question: string; reply: Reply; requestId: string; ready: boolean; saved?: boolean; sent?: boolean; rated?: "up" | "down" };
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/** Suggestions refresh after Grok's new-chat pop: all at once (no stagger), a fade and a short drop into place. */
const drop = () => {
  "worklet";
  return { initialValues: { opacity: 0, transform: [{ translateY: -10 }] },
    animations: { opacity: withTiming(1, { duration: 240 }), transform: [{ translateY: withTiming(0, { duration: 340, easing: Easing.out(Easing.cubic) }) }] } };
};

export default function Assistant() {
  const still = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { state } = useMe();
  const now = useNow();
  const { plan, dose } = useNextDose(now);
  const discharge = useDischarge();
  // The same next visit Home and Schedule show: the earliest not yet attended, never one already been to or gone by today.
  const visit = nextVisit(useFollowUps().data, now);
  const lang = useLang(), t = tFor(lang);
  const discharged = plan?.status === "discharged" ? plan : undefined;
  const asks = suggestions(discharged, visit, dose?.name, lang);
  const condition = conditionOf(discharged);
  const medicines = medicinesOf(discharged);
  const rows: Suggestion[] = [...asks.map(a => ({ question: a.question, icon: SUGGEST_ICON[a.kind] })), ...(condition ? [{ question: doctorQuestion(condition, lang), icon: SUGGEST_ICON.doctor }] : [])];
  const flood = useSharedValue(0);
  const scroll = useRef<ScrollView>(null);
  const input = useRef<RNTextInput>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  // Behind EXPO_PUBLIC_CARE_CHAT_AGENT: her chat agent, which remembers the conversation (features/assistant/chat-agent).
  const [agent, setAgent] = useState<CareChat>();
  const [chat, setChat] = useState(0);
  const [draft, setDraft] = useState("");
  const [voice, setVoice] = useState(false);
  const [typeNext, setTypeNext] = useState(false);
  useEffect(() => { if (!voice && typeNext) { input.current?.focus(); setTypeNext(false); } }, [voice, typeNext]);
  const patch = (id: string, p: Partial<Turn>) => setTurns(ts => ts.map(t => t.requestId === id ? { ...t, ...p } : t));
  const send = useMutation({
    mutationFn: (t: Turn) => client.care.messages.send({ text: t.question, requestId: t.requestId }),
    onSuccess: (_, turn) => { patch(turn.requestId, { sent: true }); AccessibilityInfo.announceForAccessibility(t("ask.sentA11y")); void queryClient.invalidateQueries({ queryKey: orpc.care.messages.key() }); },
  });
  const visitDay = visit ? dayLabel(visit.date, lang) : t("ask.yourNextVisit");
  const last = turns.at(-1);
  const working = last !== undefined && !last.ready;
  const rest = rows.filter(s => !turns.some(t => t.question === s.question));

  // Real calls: the question to the model grounded in the plan (care.ask), with this chat so far so a follow-up is
  // read with it (the new question's own turn is not in `turns` yet); a doctor question to the directory. Her chat
  // agent, behind its flag, keeps the conversation itself.
  const answerOf = (question: string) => {
    if (agent) return agent.ask(question).then(a => replyOf(question, a, asks, lang));
    const history = historyOf(turns, lang);
    return answer(question, asks, { ask: q => client.care.ask({ question: q, history }), doctors: search => client.care.doctors.list(search ? { search } : undefined) }, condition, lang);
  };
  // Her stored conversation, shown as Ask opens (the agent answers follow-ups from it).
  useEffect(() => {
    if (agent?.history.length) setTurns(ts => ts.length ? ts : agent.history.map(h => ({ question: h.question, reply: replyOf(h.question, h.answer, asks, lang), requestId: newRequestId(), ready: true })));
  }, [agent]);
  const ask = (question: string) => {
    // Asked (typed, or a suggestion tapped while typing): the keyboard goes down, or it covers the answer and leaves only its chips in view.
    Keyboard.dismiss();
    const requestId = newRequestId();
    const say = (r: Reply) => AccessibilityInfo.announceForAccessibility(r.kind === "plan" ? [spoken(r, lang), r.asked.source, r.asked.leaflet].filter(Boolean).join(" ") : spoken(r, lang));
    // The 999 card never waits for the network. The question still goes to the server, which tells the care team; once the
    // task is made, Sona's line saying so takes the place of the offer to send it. Everything else shows its status line while the call runs.
    if (urgent(question)) {
      const r: Reply = { kind: "none", urgent: true };
      setTurns(ts => [...ts, { question, reply: r, requestId, ready: true }]); say(r);
      void answerOf(question).then(next => { if (next.kind === "none" && next.careTeam) { patch(requestId, { reply: next }); AccessibilityInfo.announceForAccessibility(next.careTeam.line); } });
      return;
    }
    setTurns(ts => [...ts, { question, reply: { kind: "none", urgent: false }, requestId, ready: false }]);
    if (!still) flood.set(withTiming(1, { duration: 400, easing: EASE_OUT }));
    void answerOf(question).then(next => {
      flood.set(withTiming(0, { duration: 600, easing: EASE_OUT }));
      patch(requestId, { reply: next, ready: true });
      say(next);
    });
  };
  /** Voice mode asks the same way, and reads the answer aloud itself. */
  const askAloud = async (question: string) => {
    const requestId = newRequestId(), now = urgent(question), asked = answerOf(question);
    // ponytail: the 999 line is read at once, so the voice does not wait to say the care team was told; the chat's turn
    // gains that line when the server answers. Read it aloud too once voice mode can add to an answer it has begun.
    const r: Reply = now ? { kind: "none", urgent: true } : await asked;
    setTurns(ts => [...ts, { question, reply: r, requestId, ready: true }]);
    if (now) void asked.then(next => patch(requestId, { reply: next }));
    return r;
  };
  // Dictation runs until the patient taps stop (a pause mid-thought used to cut them off), and the words
  // land in the field to check and send; the mic only shows while the field is empty. The words stream into
  // the pill as they speak; on stop the last of them sit in the field, dimmed, until the whole recording is read.
  const join = (d: string, q: string) => d.trim() ? `${d.trim()} ${q}` : q;
  const listen = useListen({ language: lang, untilStop: true, onHeard: q => setDraft(d => join(d, q)) });
  // The mic's -60 dB (quiet) to -10 dB (loud), for the orb while the patient talks (as voice mode reads it).
  const hearing = listen.state === "listening", heard = useSharedValue(0);
  useEffect(() => { heard.set(withTiming(hearing ? Math.max(0, Math.min(1, (listen.level + 60) / 50)) : 0, { duration: 120 })); }, [hearing, listen.level]);
  const finishing = listen.state === "reading" && !!listen.partial;
  const askTyped = () => {
    const question = draft.trim();
    if (!question || working) return;
    setDraft("");
    ask(question);
  };
  const save = (turn: Turn) => {
    saveQuestion(turn.question);
    patch(turn.requestId, { saved: true });
    AccessibilityInfo.announceForAccessibility(t("ask.savedFor", { day: visitDay }));
  };
  const rate = (turn: Turn, r: "up" | "down") => {
    patch(turn.requestId, { rated: turn.rated === r ? undefined : r });
    if (turn.rated !== r) AccessibilityInfo.announceForAccessibility(t("ask.thanks"));
  };
  const fresh = () => { flood.set(0); setTurns([]); setChat(c => c + 1); agent?.clear(); };
  const newChat = () => Alert.alert(t("ask.newChatTitle"), t("ask.newChatLine"), [
    { text: t("common.cancel"), style: "cancel" },
    { text: t("ask.newChat"), onPress: fresh },
  ]);
  const enter = (i: number) => still ? undefined : FadeInDown.duration(320).easing(EASE_OUT).delay(i * 40);
  const joined = state === "joined";
  const canSend = joined && !!draft.trim() && !working;
  const lastAnswer = [...turns].reverse().find(t => t.ready);
  const link = CareChatLink && <CareChatLink onChat={setAgent} />;

  if (voice) return <Animated.View entering={still ? undefined : FadeIn.duration(240)} style={{ flex: 1 }}>
    {link}
    <VoiceMode questions={rows} answer={askAloud} language={lang} medicines={medicines} first={lastAnswer && spoken(lastAnswer.reply, lang)} firstMarks={lastAnswer?.reply.kind === "plan" ? lastAnswer.reply.asked.marks : undefined} onChat={() => setVoice(false)} onType={() => { setTypeNext(true); setVoice(false); }} />
  </Animated.View>;

  return <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
    {link}
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 4 }}>
      <CircleButton icon="back" label={t("common.back")} onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/"); }} />
      <View style={{ opacity: turns.length ? 1 : 0.4 }} pointerEvents={turns.length ? "auto" : "none"}>
        <CircleButton icon="plus" label={t("ask.newChat")} onPress={newChat} />
      </View>
    </View>

    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" onContentSizeChange={() => { if (turns.length) scroll.current?.scrollToEnd({ animated: !still }); }}
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, gap: 20 }}>
      {!turns.length ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 8 }}>
        <Animated.View entering={enter(0)} style={{ margin: -orbPad(120) + 6 }}><VoiceOrb size={120} flood={flood} hearing={hearing} level={heard} /></Animated.View>
        <Animated.View entering={enter(1)} accessible accessibilityRole="header" accessibilityLabel={t("ask.titleA11y")} style={{ alignItems: "center", gap: 4, marginTop: 8 }}>
          <AccentText style={{ ...type.display, color: palette.ink, textAlign: "center" }}>{t("ask.title")}</AccentText>
          <Text style={{ ...type.body, color: palette.faint, textAlign: "center" }}>{t("ask.subtitle")}</Text>
        </Animated.View>
      </View>
        : turns.map((turn, i) => <TurnView key={turn.requestId} t={turn} medicines={medicines} lead={i === turns.length - 1} flood={flood} enter={enter} visitDay={visitDay}
          busy={send.isPending && send.variables?.requestId === turn.requestId} error={send.variables?.requestId === turn.requestId ? send.error : null}
          onSave={() => save(turn)} onSend={() => send.mutate(turn)} onRate={r => rate(turn, r)} />)}

      {joined && !plan && discharge.error ? <LoadError query={discharge} />
        : state === "loading" || (joined && !plan) ? <ActivityIndicator color={palette.muted} style={{ minHeight: 48 }} />
        : !joined ? <Text style={{ ...type.body, color: palette.muted, textAlign: "center" }}>{t("ask.join")}</Text>
          : !rows.length ? <Text style={{ ...type.body, color: palette.muted, textAlign: "center" }}>{t("ask.onceHome")}</Text>
            : rest.length > 0 && !working && <Animated.View key={`${chat}:${rest.map(s => s.question).join("|")}`} entering={still ? undefined : drop}>
              {turns.length > 0 && <Text style={{ ...type.footnote, fontWeight: "600", color: palette.faint, marginBottom: 2 }}>{t("ask.alsoAsk")}</Text>}
              {rest.map(s => <SuggestionRow key={s.question} s={s} onPress={() => ask(s.question)} />)}
            </Animated.View>}
    </ScrollView>

    <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 12), gap: 8 }}>
      {joined && <Composer inputRef={input} value={finishing ? join(draft, listen.partial) : draft} onChangeText={setDraft} placeholder={t("ask.placeholder")} label={t("ask.label")} onSend={askTyped} canSend={canSend}
        finishing={finishing} pill={listen.state === "listening" || (listen.state === "reading" && !finishing) ? <Dictation listen={listen} /> : undefined}
        idle={<View style={{ flexDirection: "row", gap: 12 }}>
          <MicButton listen={listen} label={t("ask.speak")} quiet />
          <Pressable accessibilityRole="button" accessibilityLabel={t("ask.voiceMode")} accessibilityHint={t("ask.voiceHint")} onPress={() => { listen.cancel(); setVoice(true); }}
            style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: palette.mutedWash, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
            <Icon name="voice" color={palette.ink} size={20} />
          </Pressable>
        </View>} />}
      {listen.state === "listening" ? <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, fontWeight: "600", color: palette.blue, textAlign: "center" }}>{t("ask.listening")}</Text>
        : finishing ? <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.faint, textAlign: "center" }}>{t("mic.finishing")}</Text>
        : listen.error ? <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.amber, textAlign: "center" }}>{listen.error}</Text> : null}
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.amber, textAlign: "center" }}>{t("common.emergency")}</Text>
    </View>
  </KeyboardAvoidingView>;
}

/**
 * One question and its answer: the question in a white capsule on the right, the answer as plain text
 * on the canvas. Only the latest turn draws the live orb, and only while it works.
 */
function TurnView({ t, medicines, lead, flood, enter, visitDay, busy, error, onSave, onSend, onRate }: {
  t: Turn; medicines: string[]; lead: boolean; flood: SharedValue<number>; enter: (i: number) => FadeInDown | undefined; visitDay: string;
  busy: boolean; error: Error | null; onSave: () => void; onSend: () => void; onRate: (r: "up" | "down") => void;
}) {
  const lang = useLang(), tr = tFor(lang);
  const r = t.reply;
  const [bold, more] = leadOf(shown(r, lang));
  // The words the model chose to colour, when it answered (the word lists colour an authored answer), and the server's cards.
  const chosen = r.kind === "plan" ? r.asked.marks : undefined, cards = r.kind === "plan" ? r.asked.cards : undefined;
  // A message to the care team Sona drafted is the way to tell them: no second button offering the same.
  const drafted = cards?.some(c => c.type === "action" && c.do === "tellCareTeam");
  return <View style={{ gap: 12 }}>
    <Animated.View entering={enter(0)} style={{ alignSelf: "flex-end", maxWidth: "86%", backgroundColor: palette.white, borderRadius: 22, borderCurve: "continuous", borderWidth: 1, borderColor: palette.line, paddingHorizontal: 16, paddingVertical: 11 }}>
      <Text selectable style={{ ...type.body, color: palette.ink }}>{t.question}</Text>
    </Animated.View>
    {r.kind === "none" && r.urgent && <Animated.View entering={enter(1)}><Call999 label={tr("ask.call999")} line={tr("ask.call999Line")} /></Animated.View>}
    {!t.ready ? (lead && <Working doctors={wantsDoctor(t.question)} flood={flood} />)
      : <Animated.View entering={enter(1)} style={{ gap: 12 }}>
        <Text selectable style={{ fontSize: 17, lineHeight: 26, letterSpacing: -0.3, color: palette.ink }}>
          {/* Her medicines, how much and when, and warning signs in colour, so the answer can be scanned (terms.ts). */}
          <Marked text={bold} medicines={medicines} chosen={chosen} />{more ? <>{lang === "zh" ? "" : " "}<Marked text={more} medicines={medicines} chosen={chosen} /></> : null}
        </Text>
        {r.kind === "plan" && <Caption text={r.asked.source} />}
        {/* From their record and one of the hospital's leaflets: the leaflet is named too. */}
        {r.kind === "plan" && r.asked.leaflet && <Caption text={r.asked.leaflet} />}
        {/* Answered without the model while it starts: say so, so asking again later makes sense. */}
        {r.kind !== "doctors" && r.waking ? <Text style={{ ...type.footnote, color: palette.faint }}>{startingLine(r.waking, lang)}</Text> : null}
        <AnswerCards cards={cards} />
        {r.kind === "doctors" && <View style={{ gap: 8 }}>
          <Text style={{ ...type.overline, color: palette.faint }}>{tr("ask.doctorsHead")}</Text>
          {r.doctors.map(d => <DoctorCard key={d.id} d={d} />)}
        </View>}
        <View style={{ flexDirection: "row", marginLeft: -12 }}>
          <IconAction icon="copy" label={tr("ask.copy")} onPress={() => void Share.share({ message: spoken(r, lang) })} />
          <IconAction icon="thumbsUp" label={tr("ask.helpful")} on={t.rated === "up"} onPress={() => onRate("up")} />
          <IconAction icon="thumbsDown" label={tr("ask.notHelpful")} on={t.rated === "down"} onPress={() => onRate("down")} />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {r.kind === "plan" && (t.saved ? <Done text={tr("ask.savedFor", { day: visitDay })} /> : <Action icon="save" label={tr("ask.save")} onPress={onSave} />)}
          {/* Already told: sending it is no longer the one step that matters, so it is offered as after any answer. */}
          {t.sent ? <Done text={tr("ask.sent")} /> : r.kind === "none" && !r.careTeam
            ? <Action icon="chat" label={tr("ask.sendTeam")} busy={busy} ink onPress={onSend} />
            : !drafted && <Action icon="chat" label={tr("ask.askTeam")} busy={busy} onPress={onSend} />}
        </View>
        {error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{errorText(error, lang)}</Text>}
      </Animated.View>}
  </View>;
}

/** Where an answer is from, under it: their record (and which part), one of the hospital's leaflets by name, or general knowledge. */
function Caption({ text }: { text: string }) {
  return <View accessible accessibilityLabel={text} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
    <Icon name="doc" color={palette.faint} size={14} />
    <Text style={{ ...type.footnote, color: palette.faint, flexShrink: 1 }}>{text}</Text>
  </View>;
}

/** A small icon under an answer (copy, helpful, not helpful): 48 pt to tap, ink and filled once chosen. */
function IconAction({ icon, label, onPress, on }: { icon: IconName; label: string; onPress: () => void; on?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={on === undefined ? undefined : { selected: on }} onPress={onPress}
    style={({ pressed }) => ({ width: 48, height: 48, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}>
    <Icon name={icon} color={on ? palette.ink : palette.faint} size={18} weight={on ? "fill" : "regular"} />
  </Pressable>;
}

/** The status line while Sona works, next to the small live orb (flooding): "Reading your plan…" or "Searching for a doctor…". */
function Working({ doctors, flood }: { doctors: boolean; flood: SharedValue<number> }) {
  const t = useT();
  const label = doctors ? t("ask.searching") : t("ask.readingPlan");
  return <View accessible accessibilityLabel={label} accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
    <View style={{ margin: -orbPad(28) }}><SonaOrb size={28} flood={flood} lift={false} awake /></View>
    <AnimatedText entering={FadeIn.duration(200)} style={{ ...type.body, color: palette.faint }}>{label}</AnimatedText>
  </View>;
}
