import { useMutation } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Linking, Pressable, ScrollView, Text, TextInput, View, type ViewStyle } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { Easing, FadeInDown, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NO_ANSWER, suggestions, urgent, type Asked } from "@/features/assistant/answers";
import { useNextDose, useNow } from "@/features/doses";
import { errorText } from "@/features/errors";
import { dayLabel } from "@/features/follow-ups/lines";
import { useFollowUps } from "@/features/follow-ups/row";
import { useMe } from "@/features/me";
import { saveQuestion } from "@/features/questions";
import { orbPad, SonaOrb } from "@/lib/orb";
import { palette, type } from "@/lib/theme";
import { Button, field } from "@/lib/ui";
import { client, orpc, queryClient } from "@/utils/orpc";

/**
 * Ask Sona Care, the orb's sheet: up to three questions from the patient's own plan, answered from
 * that plan with where it came from, then the next step (save it for the visit, ask the care team,
 * done). There is no model yet, so anything typed goes to the care team, with 999 first for urgent words.
 */
type Turn = { question: string; answer?: Asked; requestId: string; ready: boolean; saved?: boolean };
const READ_MS = 800;
const newRequestId = () => `care-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const LAYOUT = LinearTransition.springify().duration(380).dampingRatio(1);
const answerCard: ViewStyle = { backgroundColor: palette.white, borderRadius: 22, borderCurve: "continuous", padding: 16, gap: 10, boxShadow: "0 12px 26px -16px rgba(80,60,140,0.45)" };
const suggestionRow: ViewStyle = { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, borderCurve: "continuous",
  borderWidth: 1, borderColor: "rgba(255,255,255,0.95)", backgroundColor: "rgba(255,255,255,0.8)", boxShadow: "0 8px 18px -14px rgba(80,60,140,0.5)" };

export default function Assistant() {
  const still = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { state, me } = useMe();
  const { plan, dose } = useNextDose(useNow());
  const visit = useFollowUps().data?.[0];
  const asks = suggestions(plan?.status === "discharged" ? plan : undefined, visit, dose?.name);
  const flood = useSharedValue(0);
  const scroll = useRef<ScrollView>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const [turn, setTurn] = useState<Turn>();
  const [draft, setDraft] = useState("");
  const send = useMutation({
    mutationFn: (t: Turn) => client.care.messages.send({ text: t.question, requestId: t.requestId }),
    onSuccess: () => { AccessibilityInfo.announceForAccessibility("Sent to your care team"); void queryClient.invalidateQueries({ queryKey: orpc.care.messages.key() }); },
  });
  const visitDay = visit ? dayLabel(visit.date) : "your next visit";

  const ask = (a: Asked) => {
    send.reset();
    clearTimeout(timer.current);
    const done = () => AccessibilityInfo.announceForAccessibility(`${a.answer} ${a.source}`);
    const next = { question: a.question, answer: a, requestId: newRequestId() };
    if (still) { setTurn({ ...next, ready: true }); done(); return; }
    setTurn({ ...next, ready: false });
    flood.set(withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    timer.current = setTimeout(() => {
      flood.set(withTiming(0, { duration: 600, easing: Easing.out(Easing.cubic) }));
      setTurn(t => t && { ...t, ready: true });
      done();
    }, READ_MS);
  };
  const askFree = () => {
    const question = draft.trim();
    if (!question) return;
    send.reset();
    clearTimeout(timer.current);
    flood.set(0);
    setDraft("");
    setTurn({ question, requestId: newRequestId(), ready: true });
    AccessibilityInfo.announceForAccessibility(urgent(question) ? `Call 999 now. ${NO_ANSWER}` : NO_ANSWER);
  };
  const save = (t: Turn) => {
    saveQuestion(t.question);
    setTurn({ ...t, saved: true });
    AccessibilityInfo.announceForAccessibility(`Saved for ${visitDay}`);
  };
  const enter = (i: number) => still ? undefined : FadeInDown.duration(320).easing(Easing.out(Easing.cubic)).delay(i * 40);

  return <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" onContentSizeChange={() => { if (turn) scroll.current?.scrollToEnd({ animated: !still }); }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 26, paddingBottom: Math.max(insets.bottom, 16), gap: 14 }}>
      <View accessible accessibilityRole="header" accessibilityLabel={`How can I help${me ? `, ${me.firstName}` : ""}? Answers come from your own discharge plan.`}
        style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <View style={{ margin: -orbPad(56) }}><SonaOrb size={56} flood={flood} /></View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...type.title, fontWeight: "700", color: palette.ink }}>How can I help{me ? `, ${me.firstName}` : ""}?</Text>
          <Text style={{ ...type.footnote, color: palette.muted }}>Answers come from your own discharge plan.</Text>
        </View>
      </View>

      {state === "loading" || (state === "joined" && !plan) ? <ActivityIndicator color={palette.muted} style={{ minHeight: 48 }} />
        : state !== "joined" ? <Text style={{ ...type.body, color: palette.muted }}>Join with the code on your discharge paper, and I can answer from your plan.</Text>
          : !asks.length ? <Text style={{ ...type.body, color: palette.muted }}>Questions from your plan show here once you're home.</Text>
            : <View style={{ gap: 8 }}>
              {asks.map((a, i) => <Animated.View key={a.question} entering={enter(i)}>
                <Pressable accessibilityRole="button" accessibilityLabel={a.question} accessibilityHint="Answers from your plan" disabled={turn && !turn.ready} onPress={() => ask(a)}
                  style={({ pressed }) => [suggestionRow, { transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
                  <Text style={{ flex: 1, fontSize: 15, lineHeight: 20, fontWeight: "600", color: palette.ink }}>{a.question}</Text>
                  <Text style={{ fontSize: 16, color: palette.muted }}>↗</Text>
                </Pressable>
              </Animated.View>)}
            </View>}

      {turn && <Animated.View key={turn.requestId} entering={enter(0)} layout={still ? undefined : LAYOUT} style={answerCard}>
        <Text selectable style={{ ...type.headline, color: palette.ink }}>{turn.question}</Text>
        {!turn.ready ? <Reading />
          : turn.answer ? <>
            <Animated.Text entering={enter(0)} selectable style={{ ...type.body, color: palette.ink }}>{turn.answer.answer}</Animated.Text>
            <Animated.View entering={enter(1)} style={{ alignSelf: "flex-start", borderRadius: 999, backgroundColor: palette.blueWash, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ fontSize: 12, fontWeight: "700", color: palette.blue }}>{turn.answer.source}</Text>
            </Animated.View>
            <Animated.View entering={enter(2)} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              {turn.saved ? <Done text={`Saved for ${visitDay}`} /> : <Button label="Save for my visit" onPress={() => save(turn)} />}
              {send.isSuccess ? <Done text="Sent · they usually reply within a few hours" /> : <Button quiet label="Ask my care team" busy={send.isPending} onPress={() => send.mutate(turn)} />}
              <Button quiet label="Thanks" onPress={() => router.back()} />
            </Animated.View>
          </>
            : <>
              {urgent(turn.question) && <Call999 />}
              <Animated.Text entering={enter(1)} style={{ ...type.body, color: palette.ink }}>{NO_ANSWER}</Animated.Text>
              <Animated.View entering={enter(2)} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                {send.isSuccess ? <Done text="Sent · they usually reply within a few hours" /> : <Button label="Send" busy={send.isPending} onPress={() => send.mutate(turn)} />}
              </Animated.View>
            </>}
        {send.error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{errorText(send.error)}</Text>}
      </Animated.View>}

      {state === "joined" && <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
        <TextInput value={draft} onChangeText={setDraft} placeholder="Ask about your care" placeholderTextColor={palette.muted} maxLength={1000}
          returnKeyType="send" onSubmitEditing={askFree} accessibilityLabel="Ask about your care" style={{ ...field, flex: 1 }} />
        <Button label="Ask" disabled={!draft.trim()} onPress={askFree} />
      </View>}
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.amber, textAlign: "center" }}>Not for emergencies · call 999</Text>
    </ScrollView>
  </KeyboardAvoidingView>;
}

/** "Reading your plan…" with three dots pulsing in turn (only shown when motion is on). */
function Reading() {
  return <View accessible accessibilityLabel="Reading your plan" style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 23 }}>
    <View style={{ flexDirection: "row", gap: 4 }}>{[0, 1, 2].map(i => <Dot key={i} i={i} />)}</View>
    <Text style={{ ...type.footnote, color: palette.muted }}>Reading your plan…</Text>
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
  return <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, fontWeight: "600", color: palette.green, flexShrink: 1, paddingVertical: 8 }}>✓ {text}</Text>;
}

/** Urgent words: the call comes before anything else. */
function Call999() {
  return <Pressable accessibilityRole="button" accessibilityLabel="Call 999 now" accessibilityHint="Chest pain, breathing trouble, fainting or bleeding can't wait for a reply" onPress={() => void Linking.openURL("tel:999")}
    style={({ pressed }) => ({ minHeight: 48, borderRadius: 16, borderCurve: "continuous", paddingHorizontal: 14, paddingVertical: 10, gap: 2, justifyContent: "center", backgroundColor: "#F8E7E7", transform: [{ scale: pressed ? 0.96 : 1 }] })}>
    <Text style={{ ...type.headline, color: palette.red }}>Call 999 now</Text>
    <Text style={{ ...type.footnote, color: palette.red }}>This can't wait for a reply from your care team.</Text>
  </Pressable>;
}
