import { useMutation } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, Linking, Pressable, ScrollView, View, type TextInput as RNTextInput, type ViewStyle } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { Easing, FadeIn, FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { conditionOf, doctorQuestion, NO_ANSWER, reply, spoken, suggestions, type Reply } from "@/features/assistant/answers";
import { SuggestionRow, VoiceMode } from "@/features/assistant/voice";
import type { Doctor } from "@/features/doctors/data";
import { useNextDose, useNow } from "@/features/doses";
import { errorText } from "@/features/errors";
import { dayLabel } from "@/features/follow-ups/lines";
import { useFollowUps } from "@/features/follow-ups/row";
import { useMe } from "@/features/me";
import { saveQuestion } from "@/features/questions";
import { orbPad, SonaOrb } from "@/lib/orb";
import { AnimatedText, Text, TextInput } from "@/lib/text";
import { accent, palette, type } from "@/lib/theme";
import { CircleButton, ICON, pillStyle, surfaceStyle } from "@/lib/ui";
import { client, orpc, queryClient } from "@/utils/orpc";

/**
 * AI Chat (Life OS frame 5), a full screen from the orb in the dock. Empty, it is the orb, "Hello, how
 * can we support your health today?", the plan's own questions (at most three) plus "Find a doctor for
 * my …" from the plan's condition, and a composer card with voice mode and send. Asked, the patient's
 * words sit in a white bubble on the right and Sona's reply in a blue bubble on the left, after a status
 * pill while it reads the plan or searches for a doctor (the orb floods). Answers come only from the
 * plan (with where from, Save for my visit, Ask my care team); doctor questions show sample doctors;
 * anything else goes to the care team, with the 999 line first for warning words.
 */
type Turn = { question: string; reply: Reply; requestId: string; ready: boolean; saved?: boolean; sent?: boolean };
const WORK_MS = { plan: 800, doctors: 1100 } as const;
const SENT = "Sent · they usually reply within a few hours";
const newRequestId = () => `care-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
// Lucide-style 24-unit paths this screen needs beyond the shared ICON set.
const GLYPH = {
  chat: ICON.chat,
  save: "m19 21l-7-4l-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z",
  up: "M12 19V5m-7 7l7-7l7 7",
  more: "M12 13a1 1 0 1 0 0-2a1 1 0 0 0 0 2M19 13a1 1 0 1 0 0-2a1 1 0 0 0 0 2M5 13a1 1 0 1 0 0-2a1 1 0 0 0 0 2",
  voice: "M2 10v3M6 6v11M10 3v18M14 8v7M18 5v13M22 10v3",
  next: "m9 18l6-6l-6-6",
};
const mine: ViewStyle = { alignSelf: "flex-end", maxWidth: "86%", backgroundColor: palette.white, borderRadius: 22, borderBottomRightRadius: 8, borderCurve: "continuous", paddingHorizontal: 16, paddingVertical: 11,
  boxShadow: "0 0 0 0.5px rgba(14,18,27,0.05), 0 10px 22px -16px rgba(14,18,27,0.3)" };
const sona: ViewStyle = { flexShrink: 1, backgroundColor: palette.blue, borderRadius: 22, borderBottomLeftRadius: 8, borderCurve: "continuous", paddingHorizontal: 16, paddingVertical: 12, gap: 10,
  boxShadow: "0 12px 24px -16px rgba(51,92,255,0.7)" };
const AVATAR = 30, INDENT = AVATAR + 10;

export default function Assistant() {
  const still = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { state } = useMe();
  const { plan, dose } = useNextDose(useNow());
  const visit = useFollowUps().data?.[0];
  const discharged = plan?.status === "discharged" ? plan : undefined;
  const asks = suggestions(discharged, visit, dose?.name);
  const condition = conditionOf(discharged);
  const rows = [...asks.map(a => a.question), ...(condition ? [doctorQuestion(condition)] : [])];
  const flood = useSharedValue(0);
  const scroll = useRef<ScrollView>(null);
  const input = useRef<RNTextInput>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [voice, setVoice] = useState(false);
  const [typeNext, setTypeNext] = useState(false);
  useEffect(() => { if (!voice && typeNext) { input.current?.focus(); setTypeNext(false); } }, [voice, typeNext]);
  const patch = (id: string, p: Partial<Turn>) => setTurns(ts => ts.map(t => t.requestId === id ? { ...t, ...p } : t));
  const send = useMutation({
    mutationFn: (t: Turn) => client.care.messages.send({ text: t.question, requestId: t.requestId }),
    onSuccess: (_, t) => { patch(t.requestId, { sent: true }); AccessibilityInfo.announceForAccessibility("Sent to your care team"); void queryClient.invalidateQueries({ queryKey: orpc.care.messages.key() }); },
  });
  const visitDay = visit ? dayLabel(visit.date) : "your next visit";
  const last = turns.at(-1);
  const working = last !== undefined && !last.ready;
  const rest = rows.filter(q => !turns.some(t => t.question === q));

  const ask = (question: string) => {
    clearTimeout(timer.current);
    const r = reply(question, asks, condition), requestId = newRequestId();
    const say = () => AccessibilityInfo.announceForAccessibility(r.kind === "plan" ? `${spoken(r)} ${r.asked.source}` : spoken(r));
    // The honest no needs no reading; plan answers and doctor searches show their status pill first.
    if (still || r.kind === "none") { setTurns(ts => [...ts, { question, reply: r, requestId, ready: true }]); say(); return; }
    setTurns(ts => [...ts, { question, reply: r, requestId, ready: false }]);
    flood.set(withTiming(1, { duration: 400, easing: EASE_OUT }));
    timer.current = setTimeout(() => {
      flood.set(withTiming(0, { duration: 600, easing: EASE_OUT }));
      patch(requestId, { ready: true });
      say();
    }, WORK_MS[r.kind]);
  };
  /** Voice mode asks the same way, but it reads the answer aloud itself, so the turn is ready at once. */
  const askAloud = (question: string) => {
    const r = reply(question, asks, condition);
    setTurns(ts => [...ts, { question, reply: r, requestId: newRequestId(), ready: true }]);
    return r;
  };
  const askTyped = () => {
    const question = draft.trim();
    if (!question || working) return;
    setDraft("");
    ask(question);
  };
  const save = (t: Turn) => {
    saveQuestion(t.question);
    patch(t.requestId, { saved: true });
    AccessibilityInfo.announceForAccessibility(`Saved for ${visitDay}`);
  };
  const clear = () => Alert.alert("Clear this chat?", "Questions you saved for your visit stay saved.", [
    { text: "Cancel", style: "cancel" },
    { text: "Clear chat", style: "destructive", onPress: () => { clearTimeout(timer.current); flood.set(0); setTurns([]); } },
  ]);
  const enter = (i: number) => still ? undefined : FadeInDown.duration(320).easing(EASE_OUT).delay(i * 40);
  const joined = state === "joined";
  const canSend = joined && !!draft.trim() && !working;

  if (voice) return <Animated.View entering={still ? undefined : FadeIn.duration(240)} style={{ flex: 1 }}>
    <VoiceMode questions={rows} answer={askAloud} onChat={() => setVoice(false)} onType={() => { setTypeNext(true); setVoice(false); }} />
  </Animated.View>;

  return <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
    <View style={{ flexDirection: "row", alignItems: "center", paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 4 }}>
      <CircleButton d={ICON.back} label="Back" onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/"); }} />
      <Text accessibilityRole="header" style={{ flex: 1, textAlign: "center", ...type.headline, color: palette.ink }}>AI Chat</Text>
      <View style={{ opacity: turns.length ? 1 : 0.4 }} pointerEvents={turns.length ? "auto" : "none"}>
        <CircleButton d={GLYPH.more} label="Clear chat" onPress={clear} />
      </View>
    </View>

    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" onContentSizeChange={() => { if (turns.length) scroll.current?.scrollToEnd({ animated: !still }); }}
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, gap: 18 }}>
      {!turns.length ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingVertical: 8 }}>
        <Animated.View entering={enter(0)} style={{ marginVertical: -orbPad(150) + 4 }}><SonaOrb size={150} flood={flood} /></Animated.View>
        <AnimatedText entering={enter(1)} accessibilityRole="header" style={{ fontSize: 30, lineHeight: 37, fontWeight: "300", letterSpacing: -0.8, color: palette.ink, textAlign: "center", paddingHorizontal: 8 }}>
          Hello, how can we support your health today?
        </AnimatedText>
      </View>
        : turns.map((t, i) => <TurnView key={t.requestId} t={t} lead={i === turns.length - 1} flood={flood} enter={enter} visitDay={visitDay}
          busy={send.isPending && send.variables?.requestId === t.requestId} error={send.variables?.requestId === t.requestId ? send.error : null}
          onSave={() => save(t)} onSend={() => send.mutate(t)} />)}

      {state === "loading" || (joined && !plan) ? <ActivityIndicator color={palette.muted} style={{ minHeight: 48 }} />
        : !joined ? <Text style={{ ...type.body, color: palette.muted, textAlign: "center" }}>Join with the code on your discharge paper, and I can answer from your plan.</Text>
          : !rows.length ? <Text style={{ ...type.body, color: palette.muted, textAlign: "center" }}>Questions from your plan show here once you're home.</Text>
            : rest.length > 0 && !working && <View style={{ gap: 10 }}>
              {turns.length > 0 && <AnimatedText entering={enter(4)} style={{ ...type.footnote, fontWeight: "600", color: palette.faint }}>You could also ask</AnimatedText>}
              {rest.map((q, i) => <Animated.View key={q} entering={enter(turns.length ? i + 5 : i + 2)}><SuggestionRow question={q} onPress={() => ask(q)} /></Animated.View>)}
            </View>}
    </ScrollView>

    <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 12), gap: 8 }}>
      {joined && <View style={[surfaceStyle, { borderRadius: 26, padding: 10, paddingTop: 4, gap: 6 }]}>
        <TextInput ref={input} value={draft} onChangeText={setDraft} placeholder="How can we help you today?" placeholderTextColor={palette.faint} maxLength={1000} multiline
          returnKeyType="send" submitBehavior="submit" onSubmitEditing={askTyped} accessibilityLabel="How can we help you today?"
          style={{ fontSize: 17, lineHeight: 22, color: palette.ink, paddingHorizontal: 8, paddingTop: 10, paddingBottom: 6, maxHeight: 120 }} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Voice mode" accessibilityHint="Sona reads answers aloud" onPress={() => setVoice(true)}
            style={({ pressed }) => ({ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 22, backgroundColor: palette.mutedWash, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
            <Glyph d={GLYPH.voice} color={palette.ink} size={18} />
            <Text style={{ fontSize: 14, fontWeight: "600", color: palette.ink }}>Voice</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Send question" accessibilityState={{ disabled: !canSend }} disabled={!canSend} onPress={askTyped}
            style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: palette.blue, opacity: canSend ? 1 : 0.35, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
            <Glyph d={GLYPH.up} color={palette.white} size={20} />
          </Pressable>
        </View>
      </View>}
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.amber, textAlign: "center" }}>Not for emergencies · call 999</Text>
    </View>
  </KeyboardAvoidingView>;
}

/**
 * One question and its reply. The latest reply's avatar is the live orb, which floods while it works;
 * earlier ones are a still accent dot, so only one orb draws at a time.
 */
function TurnView({ t, lead, flood, enter, visitDay, busy, error, onSave, onSend }: {
  t: Turn; lead: boolean; flood: SharedValue<number>; enter: (i: number) => FadeInDown | undefined; visitDay: string;
  busy: boolean; error: Error | null; onSave: () => void; onSend: () => void;
}) {
  const r = t.reply;
  return <View style={{ gap: 10 }}>
    <Animated.View entering={enter(0)} style={mine}><Text selectable style={{ ...type.body, color: palette.ink }}>{t.question}</Text></Animated.View>
    {r.kind === "none" && r.urgent && <Animated.View entering={enter(1)}><Call999 /></Animated.View>}
    <Animated.View entering={enter(1)} style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
      {lead ? <View style={{ margin: -orbPad(AVATAR) }}><SonaOrb size={AVATAR} flood={flood} lift={false} /></View>
        : <View style={{ width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, experimental_backgroundImage: `linear-gradient(135deg, #FFFFFF, ${accent[1]})` } as ViewStyle} />}
      {!t.ready ? <Working doctors={r.kind === "doctors"} />
        : <View style={sona}>
          <Text selectable style={{ ...type.body, color: palette.white }}>{r.kind === "plan" ? r.asked.answer : r.kind === "doctors" ? r.text : NO_ANSWER}</Text>
          {r.kind === "plan" && <View style={{ alignSelf: "flex-start", borderRadius: 999, backgroundColor: "rgba(255,255,255,0.2)", paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ fontSize: 12, fontWeight: "700", color: palette.white }}>{r.asked.source}</Text>
          </View>}
        </View>}
    </Animated.View>
    {t.ready && <View style={{ marginLeft: INDENT, gap: 10 }}>
      {r.kind === "doctors" && <Animated.View entering={enter(2)} style={{ gap: 8 }}>
        <Text style={{ ...type.overline, color: palette.faint }}>Sample doctors</Text>
        {r.doctors.map(d => <DoctorCard key={d.id} d={d} />)}
      </Animated.View>}
      <Animated.View entering={enter(3)} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {r.kind === "plan" && (t.saved ? <Done text={`Saved for ${visitDay}`} /> : <Action d={GLYPH.save} label="Save for my visit" onPress={onSave} />)}
        {t.sent ? <Done text={SENT} /> : r.kind === "none"
          ? <Action d={GLYPH.chat} label="Send to my care team" busy={busy} ink onPress={onSend} />
          : <Action d={GLYPH.chat} label="Ask my care team" busy={busy} onPress={onSend} />}
      </Animated.View>
      {error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{errorText(error)}</Text>}
    </View>}
  </View>;
}

/** A sample doctor inline in a reply: initials, name, specialty and where; tap for their page. */
function DoctorCard({ d }: { d: Doctor }) {
  const initials = d.name.replace(/^Dr\.\s*/, "").split(/\s+/).slice(0, 2).map(w => w[0]).join("");
  return <Pressable accessibilityRole="button" accessibilityLabel={`${d.name}, ${d.specialty}${d.careTeam ? ", your care team" : ""}. Rated ${d.rating}. ${d.room}. Sample doctor.`} accessibilityHint="Opens their page"
    onPress={() => router.push({ pathname: "/doctor", params: { id: d.id } })}
    style={({ pressed }) => [surfaceStyle, { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 20, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
    <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: palette.blueWash }}>
      <Text style={{ fontSize: 15, fontWeight: "600", color: palette.blue }}>{initials}</Text>
    </View>
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ ...type.headline, color: palette.ink }}>{d.name}</Text>
      <Text style={{ ...type.footnote, color: palette.muted }}>{d.specialty} · ★ {d.rating} · {d.room}</Text>
      {d.careTeam && <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>Your care team</Text>}
    </View>
    <Glyph d={GLYPH.next} color={palette.faint} size={18} />
  </Pressable>;
}

function Glyph({ d, color, size = 18 }: { d: string; color: string; size?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24"><Path d={d} fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}

/** A small round-ended action under a reply: an icon and a plain label. `ink` for the one that matters. */
function Action({ d, label, onPress, busy, ink }: { d: string; label: string; onPress: () => void; busy?: boolean; ink?: boolean }) {
  const fg = ink ? palette.white : palette.ink;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={onPress}
    style={({ pressed }) => [pillStyle, { minHeight: 44, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 7, transform: [{ scale: pressed ? 0.96 : 1 }] },
      ink && { backgroundColor: palette.dark, borderColor: palette.dark }]}>
    {busy ? <ActivityIndicator color={fg} /> : <Glyph d={d} color={fg} size={16} />}
    <Text style={{ fontSize: 14, fontWeight: "600", color: fg }}>{label}</Text>
  </Pressable>;
}

/** The status pill while Sona works: "Reading your plan…" or "Searching for a doctor…", three dots pulsing in turn. */
function Working({ doctors }: { doctors: boolean }) {
  const label = doctors ? "Searching for a doctor…" : "Reading your plan…";
  return <View accessible accessibilityLabel={label} accessibilityLiveRegion="polite" style={[pillStyle, { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 36, paddingHorizontal: 14 }]}>
    <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>{label}</Text>
    <View style={{ flexDirection: "row", gap: 4 }}>{[0, 1, 2].map(i => <Dot key={i} i={i} />)}</View>
  </View>;
}
function Dot({ i }: { i: number }) {
  const o = useSharedValue(1);
  useEffect(() => { o.set(withDelay(i * 150, withRepeat(withSequence(withTiming(0.25, { duration: 500 }), withTiming(1, { duration: 500 })), -1))); }, [i, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.get() }));
  return <Animated.View style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.blue }, style]} />;
}

/** The done line that replaces a next-step button once it has happened. */
function Done({ text }: { text: string }) {
  return <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, fontWeight: "600", color: palette.green, flexShrink: 1, paddingVertical: 12 }}>✓ {text}</Text>;
}

/** Urgent words: the call comes before anything else. */
function Call999() {
  return <Pressable accessibilityRole="button" accessibilityLabel="Call 999 now" accessibilityHint="Chest pain, breathing trouble, fainting or bleeding can't wait for a reply" onPress={() => void Linking.openURL("tel:999")}
    style={({ pressed }) => ({ minHeight: 48, borderRadius: 16, borderCurve: "continuous", paddingHorizontal: 14, paddingVertical: 10, gap: 2, justifyContent: "center", backgroundColor: "#F8E7E7", transform: [{ scale: pressed ? 0.96 : 1 }] })}>
    <Text style={{ ...type.headline, color: palette.red }}>Call 999 now</Text>
    <Text style={{ ...type.footnote, color: palette.red }}>This can't wait for a reply from your care team.</Text>
  </Pressable>;
}
