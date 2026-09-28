import { useMutation } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, Linking, Pressable, ScrollView, Share, View, type TextInput as RNTextInput } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { Easing, FadeIn, FadeInDown, useReducedMotion, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { conditionOf, doctorQuestion, leadOf, noAnswer, reply, spoken, suggestions, type Reply } from "@/features/assistant/answers";
import { tFor, translate, useLang, useT, type Lang } from "@/lib/i18n";
import { Composer, Glyph, GLYPH as COMPOSE } from "@/features/assistant/composer";
import { MicButton } from "@/features/assistant/mic";
import { SUGGEST_ICON, SuggestionRow, VoiceMode, type Suggestion } from "@/features/assistant/voice";
import { useListen } from "@/lib/listen";
import { DoctorAvatar } from "@/features/doctors/avatar";
import type { Doctor } from "@/features/doctors/data";
import { useNextDose, useNow } from "@/features/doses";
import { errorText } from "@/features/errors";
import { dayLabel } from "@/features/follow-ups/lines";
import { useFollowUps } from "@/features/follow-ups/row";
import { useMe } from "@/features/me";
import { saveQuestion } from "@/features/questions";
import { orbPad, SonaOrb } from "@/lib/orb";
import { AnimatedText, Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { AccentText, CircleButton, ICON, LoadError, pillStyle, surfaceStyle } from "@/lib/ui";
import { useDischarge } from "@/features/discharge/row";
import { client, orpc, queryClient } from "@/utils/orpc";

/**
 * Ask Sona Care (the AI Health Companion kit's "Ask Nomi"), a full screen from the orb in the dock.
 * Empty: the orb, "Ask Sona Care" in the headline gradient, one faint line, then up to three questions
 * from the plan plus "Find a doctor for my …" as plain rows with a small icon, and the composer card
 * (voice mode until there is text, then send). Asked: the question in a white capsule on the right, and
 * Sona's answer as plain text on the canvas, lead sentence bold, with where it came from, copy / helpful
 * / not helpful, and the next steps (Save for my visit, Ask my care team). While it works, a status line
 * sits by a small live orb. Answers come only from the plan; doctor questions show sample doctors;
 * anything else goes to the care team, with the 999 line first for warning words. + starts a new chat
 * (there is no stored history, so no history button).
 */
type Turn = { question: string; reply: Reply; requestId: string; ready: boolean; saved?: boolean; sent?: boolean; rated?: "up" | "down" };
const WORK_MS = { plan: 800, doctors: 1100 } as const;
const newRequestId = () => `care-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
// Lucide-style 24-unit paths this screen needs beyond the shared ICON set.
const GLYPH = {
  save: "m19 21l-7-4l-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z",
  copy: "M8 8h12v12H8zM4 16V4h12",
  up: "M7 10v12M15 5.88L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88",
  down: "M17 14V2M9 18.12L10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88",
  source: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8",
  next: "m9 18l6-6l-6-6",
};
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
  const { plan, dose } = useNextDose(useNow());
  const discharge = useDischarge();
  const visit = useFollowUps().data?.[0];
  const lang = useLang(), t = tFor(lang);
  const discharged = plan?.status === "discharged" ? plan : undefined;
  const asks = suggestions(discharged, visit, dose?.name, lang);
  const condition = conditionOf(discharged);
  const rows: Suggestion[] = [...asks.map(a => ({ question: a.question, d: SUGGEST_ICON[a.kind] })), ...(condition ? [{ question: doctorQuestion(condition, lang), d: SUGGEST_ICON.doctor }] : [])];
  const flood = useSharedValue(0);
  const scroll = useRef<ScrollView>(null);
  const input = useRef<RNTextInput>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const [turns, setTurns] = useState<Turn[]>([]);
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

  const ask = (question: string) => {
    clearTimeout(timer.current);
    const r = reply(question, asks, condition, lang), requestId = newRequestId();
    const say = (r: Reply) => AccessibilityInfo.announceForAccessibility(r.kind === "plan" ? `${spoken(r, lang)} ${r.asked.source}` : spoken(r, lang));
    // Anything the authored answers don't cover goes to the model, grounded in the plan (care.ask); with
    // no model switched on it answers nothing, and the honest "ask your care team" stays.
    if (r.kind === "none" && !r.urgent) {
      setTurns(ts => [...ts, { question, reply: r, requestId, ready: false }]);
      if (!still) flood.set(withTiming(1, { duration: 400, easing: EASE_OUT }));
      void client.care.ask({ question }).then(a => fromModel(a, lang), () => r).then(next => {
        flood.set(withTiming(0, { duration: 600, easing: EASE_OUT }));
        patch(requestId, { reply: next, ready: true });
        say(next);
      });
      return;
    }
    // The urgent no needs no reading; plan answers and doctor searches show their status line first.
    if (still || r.kind === "none") { setTurns(ts => [...ts, { question, reply: r, requestId, ready: true }]); say(r); return; }
    setTurns(ts => [...ts, { question, reply: r, requestId, ready: false }]);
    flood.set(withTiming(1, { duration: 400, easing: EASE_OUT }));
    timer.current = setTimeout(() => {
      flood.set(withTiming(0, { duration: 600, easing: EASE_OUT }));
      patch(requestId, { ready: true });
      say(r);
    }, WORK_MS[r.kind]);
  };
  /** Voice mode asks the same way (the model for anything the plan's own answers don't cover), and reads the answer aloud itself. */
  const askAloud = async (question: string) => {
    const r0 = reply(question, asks, condition, lang);
    const r = r0.kind === "none" && !r0.urgent ? await client.care.ask({ question }).then(a => fromModel(a, lang), () => r0) : r0;
    setTurns(ts => [...ts, { question, reply: r, requestId: newRequestId(), ready: true }]);
    return r;
  };
  const listen = useListen({ language: lang, onHeard: q => { if (!working) ask(q); } });
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
  const fresh = () => { clearTimeout(timer.current); flood.set(0); setTurns([]); setChat(c => c + 1); };
  const newChat = () => Alert.alert(t("ask.newChatTitle"), t("ask.newChatLine"), [
    { text: t("common.cancel"), style: "cancel" },
    { text: t("ask.newChat"), onPress: fresh },
  ]);
  const enter = (i: number) => still ? undefined : FadeInDown.duration(320).easing(EASE_OUT).delay(i * 40);
  const joined = state === "joined";
  const canSend = joined && !!draft.trim() && !working;
  const lastAnswer = [...turns].reverse().find(t => t.ready);

  if (voice) return <Animated.View entering={still ? undefined : FadeIn.duration(240)} style={{ flex: 1 }}>
    <VoiceMode questions={rows} answer={askAloud} language={lang} first={lastAnswer && spoken(lastAnswer.reply, lang)} onChat={() => setVoice(false)} onType={() => { setTypeNext(true); setVoice(false); }} />
  </Animated.View>;

  return <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 4 }}>
      <CircleButton d={ICON.back} label={t("common.back")} onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/"); }} />
      <View style={{ opacity: turns.length ? 1 : 0.4 }} pointerEvents={turns.length ? "auto" : "none"}>
        <CircleButton d={ICON.plus} label={t("ask.newChat")} onPress={newChat} />
      </View>
    </View>

    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" onContentSizeChange={() => { if (turns.length) scroll.current?.scrollToEnd({ animated: !still }); }}
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, gap: 20 }}>
      {!turns.length ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 8 }}>
        <Animated.View entering={enter(0)} style={{ margin: -orbPad(120) + 6 }}><SonaOrb size={120} flood={flood} /></Animated.View>
        <Animated.View entering={enter(1)} accessible accessibilityRole="header" accessibilityLabel={t("ask.titleA11y")} style={{ alignItems: "center", gap: 4, marginTop: 8 }}>
          <AccentText style={{ ...type.display, color: palette.ink, textAlign: "center" }}>{t("ask.title")}</AccentText>
          <Text style={{ ...type.body, color: palette.faint, textAlign: "center" }}>{t("ask.subtitle")}</Text>
        </Animated.View>
      </View>
        : turns.map((turn, i) => <TurnView key={turn.requestId} t={turn} lead={i === turns.length - 1} flood={flood} enter={enter} visitDay={visitDay}
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
      {joined && <Composer inputRef={input} value={draft} onChangeText={setDraft} placeholder={t("ask.placeholder")} label={t("ask.label")} onSend={askTyped} canSend={canSend}
        idle={<View style={{ flexDirection: "row", gap: 6 }}>
          <MicButton listen={listen} label={t("ask.speak")} />
          <Pressable accessibilityRole="button" accessibilityLabel={t("ask.voiceMode")} accessibilityHint={t("ask.voiceHint")}onPress={() => { listen.cancel(); setVoice(true); }}
            style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: palette.mutedWash, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
            <Glyph d={COMPOSE.voice} color={palette.ink} size={20} />
          </Pressable>
        </View>} />}
      {listen.state === "listening" ? <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, fontWeight: "600", color: palette.blue, textAlign: "center" }}>{t("ask.listening")}</Text>
        : listen.state === "reading" ? <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.muted, textAlign: "center" }}>{t("ask.reading")}</Text>
          : listen.error ? <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.amber, textAlign: "center" }}>{listen.error}</Text> : null}
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.amber, textAlign: "center" }}>{t("common.emergency")}</Text>
    </View>
  </KeyboardAvoidingView>;
}

/**
 * One question and its answer: the question in a white capsule on the right, the answer as plain text
 * on the canvas. Only the latest turn draws the live orb, and only while it works.
 */
function TurnView({ t, lead, flood, enter, visitDay, busy, error, onSave, onSend, onRate }: {
  t: Turn; lead: boolean; flood: SharedValue<number>; enter: (i: number) => FadeInDown | undefined; visitDay: string;
  busy: boolean; error: Error | null; onSave: () => void; onSend: () => void; onRate: (r: "up" | "down") => void;
}) {
  const lang = useLang(), tr = tFor(lang);
  const r = t.reply;
  const text = r.kind === "plan" ? r.asked.answer : r.kind === "doctors" ? r.text : noAnswer(lang);
  const [bold, more] = leadOf(text);
  return <View style={{ gap: 12 }}>
    <Animated.View entering={enter(0)} style={{ alignSelf: "flex-end", maxWidth: "86%", backgroundColor: palette.white, borderRadius: 22, borderCurve: "continuous", borderWidth: 1, borderColor: palette.line, paddingHorizontal: 16, paddingVertical: 11 }}>
      <Text selectable style={{ ...type.body, color: palette.ink }}>{t.question}</Text>
    </Animated.View>
    {r.kind === "none" && r.urgent && <Animated.View entering={enter(1)}><Call999 /></Animated.View>}
    {!t.ready ? (lead && <Working doctors={r.kind === "doctors"} flood={flood} />)
      : <Animated.View entering={enter(1)} style={{ gap: 12 }}>
        <Text selectable style={{ fontSize: 17, lineHeight: 26, letterSpacing: -0.3, color: palette.ink }}>
          <Text style={{ fontWeight: "700" }}>{bold}</Text>{more ? `${lang === "zh" ? "" : " "}${more}` : ""}
        </Text>
        {r.kind === "plan" && <View accessible accessibilityLabel={r.asked.source} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Glyph d={GLYPH.source} color={palette.faint} size={14} />
          <Text style={{ ...type.footnote, color: palette.faint }}>{r.asked.source}</Text>
        </View>}
        {r.kind === "doctors" && <View style={{ gap: 8 }}>
          <Text style={{ ...type.overline, color: palette.faint }}>{tr("ask.sampleDoctors")}</Text>
          {r.doctors.map(d => <DoctorCard key={d.id} d={d} />)}
        </View>}
        <View style={{ flexDirection: "row", marginLeft: -12 }}>
          <IconAction d={GLYPH.copy} label={tr("ask.copy")} onPress={() => void Share.share({ message: spoken(r, lang) })} />
          <IconAction d={GLYPH.up} label={tr("ask.helpful")} on={t.rated === "up"} onPress={() => onRate("up")} />
          <IconAction d={GLYPH.down} label={tr("ask.notHelpful")} on={t.rated === "down"} onPress={() => onRate("down")} />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {r.kind === "plan" && (t.saved ? <Done text={tr("ask.savedFor", { day: visitDay })} /> : <Action d={GLYPH.save} label={tr("ask.save")} onPress={onSave} />)}
          {t.sent ? <Done text={tr("ask.sent")} /> : r.kind === "none"
            ? <Action d={ICON.chat} label={tr("ask.sendTeam")} busy={busy} ink onPress={onSend} />
            : <Action d={ICON.chat} label={tr("ask.askTeam")} busy={busy} onPress={onSend} />}
        </View>
        {error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{errorText(error, lang)}</Text>}
      </Animated.View>}
  </View>;
}

/** A care.ask answer as a reply: grounded in the plan (with where from), or the honest no (urgent when the model heard a warning sign). */
function fromModel(a: Awaited<ReturnType<typeof client.care.ask>>, lang: Lang): Reply {
  if (a.source !== "model" || !a.answer) return { kind: "none", urgent: false };
  if (!a.grounded) return { kind: "none", urgent: a.urgent };
  return { kind: "plan", asked: { question: "", answer: a.answer, source: a.from ? translate(lang, "ask.fromModel", { from: a.from }) : translate(lang, "ask.plan"), kind: "medicine" } };
}

/** A sample doctor inline in an answer: their initials disc, name, specialty and where; tap for their page. */
function DoctorCard({ d }: { d: Doctor }) {
  const t = useT();
  return <Pressable accessibilityRole="button" accessibilityLabel={t("ask.doctorA11y", { name: d.name, specialty: d.specialty, team: d.careTeam ? t("ask.yourTeamA11y") : "", rating: d.rating, room: d.room })} accessibilityHint={t("ask.openPage")}
    onPress={() => router.push({ pathname: "/doctor", params: { id: d.id } })}
    style={({ pressed }) => [surfaceStyle, { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 24, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
    <DoctorAvatar doctor={d} size={48} />
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ ...type.headline, color: palette.ink }}>{d.name}</Text>
      <Text style={{ ...type.footnote, color: palette.muted }}>{d.specialty} · ★ {d.rating} · {d.room}</Text>
      {d.careTeam && <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>{t("ask.yourTeam")}</Text>}
    </View>
    <Glyph d={GLYPH.next} color={palette.faint} size={18} />
  </Pressable>;
}

/** A small icon under an answer (copy, helpful, not helpful): 48 pt to tap, ink once chosen. */
function IconAction({ d, label, onPress, on }: { d: string; label: string; onPress: () => void; on?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={on === undefined ? undefined : { selected: on }} onPress={onPress}
    style={({ pressed }) => ({ width: 48, height: 48, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}>
    <Glyph d={d} color={on ? palette.ink : palette.faint} size={18} width={on ? 2.2 : 1.8} />
  </Pressable>;
}

/** A next step under an answer: a white capsule with an icon and a plain label. `ink` for the one that matters. */
function Action({ d, label, onPress, busy, ink }: { d: string; label: string; onPress: () => void; busy?: boolean; ink?: boolean }) {
  const fg = ink ? palette.white : palette.ink;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={onPress}
    style={({ pressed }) => [pillStyle, { maxWidth: "100%", minHeight: 48, paddingHorizontal: 16, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 7, transform: [{ scale: pressed ? 0.96 : 1 }] },
      ink && { backgroundColor: palette.dark, borderColor: palette.dark }]}>
    {busy ? <ActivityIndicator color={fg} /> : <Glyph d={d} color={fg} size={16} />}
    <Text style={{ flexShrink: 1, fontSize: 15, fontWeight: "600", color: fg }}>{label}</Text>
  </Pressable>;
}

/** The status line while Sona works, next to the small live orb (flooding): "Reading your plan…" or "Searching for a doctor…". */
function Working({ doctors, flood }: { doctors: boolean; flood: SharedValue<number> }) {
  const t = useT();
  const label = doctors ? t("ask.searching") : t("ask.readingPlan");
  return <View accessible accessibilityLabel={label} accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
    <View style={{ margin: -orbPad(28) }}><SonaOrb size={28} flood={flood} lift={false} /></View>
    <AnimatedText entering={FadeIn.duration(200)} style={{ ...type.body, color: palette.faint }}>{label}</AnimatedText>
  </View>;
}

/** The done line that replaces a next-step button once it has happened. */
function Done({ text }: { text: string }) {
  return <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, fontWeight: "600", color: palette.green, flexShrink: 1, paddingVertical: 12 }}>✓ {text}</Text>;
}

/** Urgent words: the call comes before anything else. */
function Call999() {
  const t = useT();
  return <Pressable accessibilityRole="button" accessibilityLabel={t("ask.call999")} accessibilityHint={t("ask.call999Hint")} onPress={() => void Linking.openURL("tel:999")}
    style={({ pressed }) => ({ minHeight: 48, borderRadius: 20, borderCurve: "continuous", paddingHorizontal: 16, paddingVertical: 12, gap: 2, justifyContent: "center", backgroundColor: "#FDECEC", transform: [{ scale: pressed ? 0.96 : 1 }] })}>
    <Text style={{ ...type.headline, color: palette.red }}>{t("ask.call999")}</Text>
    <Text style={{ ...type.footnote, color: palette.red }}>{t("ask.call999Line")}</Text>
  </Pressable>;
}
