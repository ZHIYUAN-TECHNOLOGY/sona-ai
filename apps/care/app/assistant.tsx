import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Linking, Pressable, ScrollView, View, type ViewStyle } from "react-native";
import { Text, TextInput, AnimatedText } from "@/lib/text";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { Easing, FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { NO_ANSWER, suggestions, urgent, type Asked } from "@/features/assistant/answers";
import { useNextDose, useNow } from "@/features/doses";
import { errorText } from "@/features/errors";
import { dayLabel } from "@/features/follow-ups/lines";
import { useFollowUps } from "@/features/follow-ups/row";
import { useMe } from "@/features/me";
import { saveQuestion } from "@/features/questions";
import { orbPad, SonaOrb } from "@/lib/orb";
import { palette, type } from "@/lib/theme";
import { AccentText, ICON, pillStyle } from "@/lib/ui";
import { client, orpc, queryClient } from "@/utils/orpc";

/**
 * Ask Sona Care, the orb's sheet (after the Lumi kit's "Ask Nomi"): the orb and "Ask Sona Care" centred,
 * up to three questions from the patient's own plan, and a composer pinned to the bottom. The patient's
 * question sits in a white bubble on the right; the answer is plain text from that plan with where it
 * came from, then the next step (save it for the visit, ask the care team) and the plan's other questions.
 * There is no model yet, so anything typed goes to the care team, with 999 first for urgent words.
 */
type Turn = { question: string; answer?: Asked; requestId: string; ready: boolean; saved?: boolean; sent?: boolean };
const READ_MS = 800;
const SENT = "Sent · they usually reply within a few hours";
const newRequestId = () => `care-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// Lucide-style 24-unit paths this sheet needs beyond the shared ICON set.
const GLYPH = {
  dose: ICON.alarm, chat: ICON.chat,
  medicine: "m10.5 20.5l10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7m-2-12l7 7",
  visit: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2",
  save: "m19 21l-7-4l-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z",
  up: "M12 19V5m-7 7l7-7l7 7",
};
const bubble: ViewStyle = { alignSelf: "flex-end", maxWidth: "86%", backgroundColor: palette.white, borderRadius: 22, borderBottomRightRadius: 8, borderCurve: "continuous", paddingHorizontal: 16, paddingVertical: 11,
  borderWidth: 1, borderColor: "rgba(40,24,70,0.05)", boxShadow: "0 8px 20px -14px rgba(60,70,140,0.45)" };

export default function Assistant() {
  const still = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { state } = useMe();
  const { plan, dose } = useNextDose(useNow());
  const visit = useFollowUps().data?.[0];
  const asks = suggestions(plan?.status === "discharged" ? plan : undefined, visit, dose?.name);
  const flood = useSharedValue(0);
  const scroll = useRef<ScrollView>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const patch = (id: string, p: Partial<Turn>) => setTurns(ts => ts.map(t => t.requestId === id ? { ...t, ...p } : t));
  const send = useMutation({
    mutationFn: (t: Turn) => client.care.messages.send({ text: t.question, requestId: t.requestId }),
    onSuccess: (_, t) => { patch(t.requestId, { sent: true }); AccessibilityInfo.announceForAccessibility("Sent to your care team"); void queryClient.invalidateQueries({ queryKey: orpc.care.messages.key() }); },
  });
  const visitDay = visit ? dayLabel(visit.date) : "your next visit";
  const last = turns.at(-1);
  const reading = last !== undefined && !last.ready;
  const rest = asks.filter(a => !turns.some(t => t.question === a.question));

  const ask = (a: Asked) => {
    clearTimeout(timer.current);
    const requestId = newRequestId();
    const done = () => AccessibilityInfo.announceForAccessibility(`${a.answer} ${a.source}`);
    if (still) { setTurns(ts => [...ts, { question: a.question, answer: a, requestId, ready: true }]); done(); return; }
    setTurns(ts => [...ts, { question: a.question, answer: a, requestId, ready: false }]);
    flood.set(withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    timer.current = setTimeout(() => {
      flood.set(withTiming(0, { duration: 600, easing: Easing.out(Easing.cubic) }));
      patch(requestId, { ready: true });
      done();
    }, READ_MS);
  };
  const askFree = () => {
    const question = draft.trim();
    if (!question || reading) return;
    setDraft("");
    setTurns(ts => [...ts, { question, requestId: newRequestId(), ready: true }]);
    AccessibilityInfo.announceForAccessibility(urgent(question) ? `Call 999 now. ${NO_ANSWER}` : NO_ANSWER);
  };
  const save = (t: Turn) => {
    saveQuestion(t.question);
    patch(t.requestId, { saved: true });
    AccessibilityInfo.announceForAccessibility(`Saved for ${visitDay}`);
  };
  const enter = (i: number) => still ? undefined : FadeInDown.duration(320).easing(Easing.out(Easing.cubic)).delay(i * 40);
  const canSend = state === "joined" && !!draft.trim() && !reading;

  return <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" onContentSizeChange={() => { if (turns.length) scroll.current?.scrollToEnd({ animated: !still }); }}
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 28, paddingBottom: 12, gap: 16 }}>
      {!turns.length ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 8 }}>
        <View style={{ margin: -orbPad(96), marginBottom: -orbPad(96) + 8 }}><SonaOrb size={96} flood={flood} /></View>
        <View accessible accessibilityRole="header" accessibilityLabel="Ask Sona Care. Clear answers from your own plan." style={{ alignItems: "center", gap: 4 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center" }}>
            <Text style={{ ...type.display, fontWeight: "700", color: palette.ink }}>Ask </Text>
            <AccentText style={{ ...type.display, fontWeight: "700" }}>Sona Care</AccentText>
          </View>
          <Text style={{ ...type.body, color: palette.faint, textAlign: "center" }}>Clear answers from your own plan</Text>
        </View>
      </View>
        : turns.map((t, i) => <TurnView key={t.requestId} t={t} lead={i === turns.length - 1} flood={flood} enter={enter} visitDay={visitDay}
          busy={send.isPending && send.variables?.requestId === t.requestId} error={send.variables?.requestId === t.requestId ? send.error : null}
          onSave={() => save(t)} onSend={() => send.mutate(t)} />)}

      {state === "loading" || (state === "joined" && !plan) ? <ActivityIndicator color={palette.muted} style={{ minHeight: 48 }} />
        : state !== "joined" ? <Text style={{ ...type.body, color: palette.muted, textAlign: "center" }}>Join with the code on your discharge paper, and I can answer from your plan.</Text>
          : !asks.length ? <Text style={{ ...type.body, color: palette.muted, textAlign: "center" }}>Questions from your plan show here once you're home.</Text>
            : rest.length > 0 && !reading && <View style={{ gap: 2 }}>
              {turns.length > 0 && <AnimatedText entering={enter(4)} style={{ ...type.footnote, fontWeight: "600", color: palette.faint, marginBottom: 2 }}>You could also ask</AnimatedText>}
              {rest.map((a, i) => <Animated.View key={a.question} entering={enter(turns.length ? i + 5 : i)}>
                <Pressable accessibilityRole="button" accessibilityLabel={a.question} accessibilityHint="Answers from your plan" onPress={() => ask(a)}
                  style={({ pressed }) => ({ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, opacity: pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
                  <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: palette.blueWash }}><Glyph d={GLYPH[a.kind]} color={palette.blue} /></View>
                  <Text style={{ flex: 1, ...type.body, fontWeight: "500", color: palette.ink }}>{a.question}</Text>
                </Pressable>
              </Animated.View>)}
            </View>}
    </ScrollView>

    <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 12), gap: 8 }}>
      {state === "joined" && <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, minHeight: 56, borderRadius: 28, borderCurve: "continuous", padding: 6, paddingLeft: 18,
        backgroundColor: palette.mutedWash, borderWidth: 1, borderColor: "rgba(40,24,70,0.05)" }}>
        <TextInput value={draft} onChangeText={setDraft} placeholder="Ask about your care…" placeholderTextColor={palette.muted} maxLength={1000} multiline
          returnKeyType="send" submitBehavior="submit" onSubmitEditing={askFree} accessibilityLabel="Ask about your care"
          style={{ flex: 1, fontSize: 17, lineHeight: 22, color: palette.ink, paddingTop: 11, paddingBottom: 11, maxHeight: 120 }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Send question" accessibilityState={{ disabled: !canSend }} disabled={!canSend} onPress={askFree}
          style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: palette.dark, opacity: canSend ? 1 : 0.3, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
          <Glyph d={GLYPH.up} color={palette.white} size={20} />
        </Pressable>
      </View>}
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.amber, textAlign: "center" }}>Not for emergencies · call 999</Text>
    </View>
  </KeyboardAvoidingView>;
}

/**
 * One question and its answer. The latest answer leads with the small orb, which floods while it reads
 * the plan; earlier ones are plain text, so only one orb draws at a time.
 */
function TurnView({ t, lead, flood, enter, visitDay, busy, error, onSave, onSend }: {
  t: Turn; lead: boolean; flood: SharedValue<number>; enter: (i: number) => FadeInDown | undefined; visitDay: string;
  busy: boolean; error: Error | null; onSave: () => void; onSend: () => void;
}) {
  return <View style={{ gap: 12 }}>
    <Animated.View entering={enter(0)} style={bubble}><Text selectable style={{ ...type.body, color: palette.ink }}>{t.question}</Text></Animated.View>
    <View style={{ gap: 10 }}>
      {lead && <Animated.View entering={enter(1)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ margin: -orbPad(28) }}><SonaOrb size={28} flood={flood} lift={false} /></View>
        {!t.ready && <Reading />}
      </Animated.View>}
      {t.ready && (t.answer ? <>
        <AnimatedText entering={enter(1)} selectable style={{ ...type.body, color: palette.ink }}>{t.answer.answer}</AnimatedText>
        <Animated.View entering={enter(2)} style={{ alignSelf: "flex-start", borderRadius: 999, backgroundColor: palette.blueWash, paddingHorizontal: 10, paddingVertical: 5 }}>
          <Text style={{ fontSize: 12, fontWeight: "700", color: palette.blue }}>{t.answer.source}</Text>
        </Animated.View>
        <Animated.View entering={enter(3)} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {t.saved ? <Done text={`Saved for ${visitDay}`} /> : <Action d={GLYPH.save} label="Save for my visit" onPress={onSave} />}
          {t.sent ? <Done text={SENT} /> : <Action d={GLYPH.chat} label="Ask my care team" busy={busy} onPress={onSend} />}
        </Animated.View>
      </> : <>
        {urgent(t.question) && <Animated.View entering={enter(1)}><Call999 /></Animated.View>}
        <AnimatedText entering={enter(2)} style={{ ...type.body, color: palette.ink }}>{NO_ANSWER}</AnimatedText>
        <Animated.View entering={enter(3)} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {t.sent ? <Done text={SENT} /> : <Action d={GLYPH.chat} label="Send to my care team" busy={busy} ink onPress={onSend} />}
        </Animated.View>
      </>)}
      {error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{errorText(error)}</Text>}
    </View>
  </View>;
}

function Glyph({ d, color, size = 18 }: { d: string; color: string; size?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24"><Path d={d} fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}

/** A small round-ended action under an answer: an icon and a plain label (older patients read words faster than icons). `ink` for the one that matters. */
function Action({ d, label, onPress, busy, ink }: { d: string; label: string; onPress: () => void; busy?: boolean; ink?: boolean }) {
  const fg = ink ? palette.white : palette.ink;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={onPress}
    style={({ pressed }) => [pillStyle, { minHeight: 44, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 7, transform: [{ scale: pressed ? 0.96 : 1 }] },
      ink && { backgroundColor: palette.dark, borderColor: palette.dark }]}>
    {busy ? <ActivityIndicator color={fg} /> : <Glyph d={d} color={fg} size={16} />}
    <Text style={{ fontSize: 14, fontWeight: "600", color: fg }}>{label}</Text>
  </Pressable>;
}

/** "Reading your plan…" with three dots pulsing in turn (only shown when motion is on). */
function Reading() {
  return <View accessible accessibilityLabel="Reading your plan" style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 23 }}>
    <Text style={{ ...type.footnote, color: palette.muted }}>Reading your plan…</Text>
    <View style={{ flexDirection: "row", gap: 4 }}>{[0, 1, 2].map(i => <Dot key={i} i={i} />)}</View>
  </View>;
}
function Dot({ i }: { i: number }) {
  const o = useSharedValue(1);
  useEffect(() => { o.set(withDelay(i * 150, withRepeat(withSequence(withTiming(0.25, { duration: 500 }), withTiming(1, { duration: 500 })), -1))); }, [i, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#8E7FEA" }, style]} />;
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
