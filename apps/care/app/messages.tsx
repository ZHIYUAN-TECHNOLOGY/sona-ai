import { useMutation } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Keyboard, ScrollView, View, type ViewStyle } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { FadeIn, LayoutAnimationConfig, useReducedMotion, withDelay, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Composer } from "@/features/assistant/composer";
import { errorText } from "@/features/errors";
import { useMe } from "@/features/me";
import { clockOf, type Message, suggestions, urgentFromTeam, whileYouWait, withDays } from "@/features/messages/model";
import { tFor, useLang, useT } from "@/lib/i18n";
import { markRead, useThread } from "@/features/messages/row";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { BackButton, Call999, Card, Chip, pillStyle, surfaceStyle, LoadError } from "@/lib/ui";
import { client, orpc, queryClient } from "@/utils/orpc";
import { now as clockNow } from "@/lib/clock";

/**
 * The thread with the care team, after the AI Health Companion kit: back, "Care team" centred with the
 * reply time faint under it; the care team on the left in flat kit cards with their initials and the
 * time, the patient on the right in ink; a white day capsule per day. A sent message springs up from
 * the composer and is followed by its status ("Sent · 12:01", then "Seen by care team · 12:04"); a
 * warning sign in it adds what to do while waiting. The care team's urgent message ("call 999 now") is
 * red, with a Call 999 button under it. Up to three likely replies sit over the composer as chips and send
 * in one tap; while the keyboard is up they sit right where a tap to put it down lands, so that tap only puts it down
 * (a message to the care team, "I'm going to the emergency department", is never sent by accident). The emergency line never leaves the screen. Replies arrive over the live socket (features/live).
 */
const newRequestId = () => `care-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
type Draft = { text: string; requestId: string; at: Date };

export default function Messages() {
  const threadQuery = useThread(), { data, error } = threadQuery;
  const { me } = useMe();
  const lang = useLang(), t = tFor(lang);
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const scroll = useRef<ScrollView>(null);
  const [text, setText] = useState("");
  // One ID per message text, so a retry after a dropped connection is not sent twice, and a different message never reuses it.
  const [attempt, setAttempt] = useState({ text: "", requestId: newRequestId() });
  const send = useMutation({
    mutationFn: (d: Draft) => client.care.messages.send({ text: d.text, requestId: d.requestId }),
    onSuccess: sent => {
      setText("");
      setAttempt({ text: "", requestId: newRequestId() });
      // Show the stored message at once (same key as the sending bubble, so it doesn't spring twice), then re-read.
      queryClient.setQueryData(orpc.care.messages.list.queryKey(), old => old && !old.some(m => m.id === sent.id) ? [...old, sent] : old);
      void queryClient.invalidateQueries({ queryKey: orpc.care.messages.key() });
      AccessibilityInfo.announceForAccessibility(t("msg.sentA11y", { reply: t("msg.replyTime") }));
    },
  });
  const go = (words: string) => {
    const t = words.trim();
    if (!t || send.isPending) return;
    // Sent: the keyboard goes down, so the message and what follows it (its status, what to do while waiting) are in view.
    Keyboard.dismiss();
    const requestId = t === attempt.text ? attempt.requestId : newRequestId();
    setAttempt({ text: t, requestId });
    if (process.env.EXPO_OS === "ios") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    send.mutate({ text: t, requestId, at: clockNow() });
  };

  // While sending, the message shows under the ID the server will give it (see care.messages.send).
  const sending = send.isPending && send.variables && me ? { id: `message:${me.patientId}:${send.variables.requestId}`, from: "patient" as const, text: send.variables.text, createdAt: send.variables.at, seenAt: null, attachment: null } : undefined;
  const thread: Message[] = data ? (sending && !data.some(m => m.id === sending.id) ? [...data, sending] : data) : [];
  const last = thread.at(-1);
  const wait = whileYouWait(thread, lang);
  const picks = text.trim() || send.isPending ? [] : suggestions(thread, lang);
  const lastId = data?.at(-1)?.id;
  useEffect(() => { if (lastId) markRead(lastId); }, [lastId]);

  return <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
    <View style={{ flexDirection: "row", alignItems: "center", paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 4 }}>
      <BackButton />
      <View accessible accessibilityRole="header" accessibilityLabel={t("msg.headerA11y", { hospital: me?.hospital ? `, ${me.hospital}` : "", reply: t("msg.replyTime") })} style={{ flex: 1, alignItems: "center" }}>
        <Text style={{ fontSize: 20, lineHeight: 26, fontWeight: "600", letterSpacing: -0.6, color: palette.ink, textAlign: "center" }}>{t("msg.title")}</Text>
        <Text style={{ ...type.footnote, color: palette.faint, textAlign: "center" }}>{t("msg.replyTime")}</Text>
      </View>
      <View style={{ width: 48 }} />
    </View>

    <ScrollView ref={scroll} keyboardDismissMode="interactive" onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, gap: 14 }}>
      {!data ? (error ? <LoadError query={threadQuery} /> : <ActivityIndicator color={palette.muted} />)
        // Messages there on opening appear still; only what arrives while the screen is open moves.
        : <LayoutAnimationConfig skipEntering><View style={{ gap: 14 }}>
          {!thread.length && <Card><Text style={{ ...type.body, color: palette.muted }}>{t("msg.empty")}</Text></Card>}
          {withDays(thread, clockNow(), lang).map(item => "day" in item
            ? <Pill key={`day-${item.day}`} label={item.day} />
            : <Bubble key={item.message.id} m={item.message} sending={item.message.id === sending?.id} reduced={reduced} />)}
          {/* Sent, then "Seen by care team" once a nurse or doctor opens the thread (it fades in over the sent line). */}
          {last?.from === "patient" && <Animated.View key={`status-${last.id}-${last.seenAt ? "seen" : "sent"}`} entering={reduced || last.seenAt ? FadeIn.duration(300) : rise(250)} style={{ alignSelf: "center" }}>
            <Pill label={last.id === sending?.id ? t("msg.sending") : last.seenAt ? t("msg.seen", { time: clockOf(last.seenAt) }) : t("msg.sent", { time: clockOf(last.createdAt) })} />
          </Animated.View>}
          {wait && <Animated.View key={`wait-${last!.id}`} entering={reduced ? FadeIn.duration(200) : rise(400)} accessible accessibilityLabel={t("msg.waitA11y", { wait, call: t("msg.wait999") })}
            style={{ borderRadius: 24, borderCurve: "continuous", padding: 18, gap: 6, backgroundColor: palette.amberWash, borderWidth: 1, borderColor: palette.amberEdge }}>
            <Text style={{ ...type.headline, color: palette.amber }}>{t("msg.waitTitle")}</Text>
            <Text style={{ ...type.body, color: palette.ink }}>{wait}</Text>
            <Text style={{ ...type.body, fontWeight: "700", color: palette.red }}>{t("msg.wait999")}</Text>
          </Animated.View>}
        </View></LayoutAnimationConfig>}
    </ScrollView>

    <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 12), gap: 8 }}>
      {data && picks.length > 0 && <Animated.View key={picks.join("|")} entering={FadeIn.duration(220)} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {picks.map(p => <Chip key={p} label={p} accessibilityLabel={t("msg.chipA11y", { p })} onPress={() => Keyboard.isVisible() ? Keyboard.dismiss() : go(p)} />)}
      </Animated.View>}
      {send.error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{errorText(send.error, lang)}</Text>}
      <Composer value={text} onChangeText={setText} placeholder={t("msg.placeholder")} label={t("msg.label")} onSend={() => go(text)} canSend={!!text.trim() && !send.isPending} busy={send.isPending} />
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.amber, textAlign: "center" }}>{t("common.emergency")}</Text>
    </View>
  </KeyboardAvoidingView>;
}

/** A white capsule in the thread: a day, or what happens next. */
function Pill({ label }: { label: string }) {
  return <View style={[pillStyle, { alignSelf: "center", paddingHorizontal: 14, paddingVertical: 6 }]}>
    <Text style={{ ...type.footnote, fontSize: 13, fontWeight: "500", color: palette.muted }}>{label}</Text>
  </View>;
}

function Bubble({ m, sending, reduced }: { m: Message; sending: boolean; reduced: boolean }) {
  const t = useT();
  const mine = m.from === "patient", urgent = urgentFromTeam(m);
  // Sona's call-999 line is the safety rule's template, sent by itself (`rule`): it is not passed off as the care team's own words.
  const auto = "rule" in m && m.rule === "call-999";
  const who = mine ? t("msg.you") : auto ? t("msg.auto") : t("msg.title");
  const tail: ViewStyle = mine ? { borderBottomRightRadius: 8 } : { borderBottomLeftRadius: 8 };
  const enter = reduced ? FadeIn.duration(200) : mine ? springIn : FadeIn.duration(240);
  const bubble = <Animated.View entering={enter} accessible accessibilityLabel={`${who}, ${sending ? t("msg.sendingA11y") : clockOf(m.createdAt)}: ${m.text}`}
    style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "86%", flexDirection: "row", alignItems: "flex-end", gap: 8, transformOrigin: "right bottom" }}>
    {!mine && <Initials />}
    <View style={{ flexShrink: 1, gap: 4, alignItems: mine ? "flex-end" : "flex-start" }}>
      <View style={[mine ? { backgroundColor: palette.dark, borderRadius: 24, borderCurve: "continuous" }
        : urgent ? { backgroundColor: palette.redWash, borderWidth: 1, borderColor: palette.redEdge, borderRadius: 24, borderCurve: "continuous" } : { ...surfaceStyle, borderRadius: 24 }, tail, { paddingHorizontal: 16, paddingVertical: 12 }]}>
        <Text selectable style={{ ...type.body, color: mine ? palette.white : palette.ink }}>{m.text}</Text>
      </View>
      <Text style={{ fontSize: 12, lineHeight: 16, color: palette.faint, paddingHorizontal: 4 }}>{mine ? "" : auto ? `${t("msg.auto")} · ` : t("msg.teamAt")}{sending ? t("msg.sending") : clockOf(m.createdAt)}</Text>
    </View>
  </Animated.View>;
  if (!urgent) return bubble;
  // Must not be missed: the call sits under the message, outside its spoken label, so VoiceOver reaches the button.
  return <>{bubble}<Animated.View entering={enter} style={{ marginLeft: 42 }}><Call999 label={t("msg.call999")} line={t("msg.call999Line")} /></Animated.View></>;
}

/** The care team's mark: "CT" on a soft wash with a white rim (the thread names no one, so no person's initials). */
function Initials() {
  const t = useT();
  return <View style={{ width: 34, height: 34, borderRadius: 17, marginBottom: 20, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: palette.white,
    experimental_backgroundImage: "linear-gradient(145deg, #EBF1FF, #C9D5FF)", boxShadow: "0 6px 14px -8px rgba(37,99,235,0.45)" } as ViewStyle}>
    <Text allowFontScaling={false} style={{ fontSize: 11, fontWeight: "600", color: palette.blue }}>{t("msg.initials")}</Text>
  </View>;
}

/** A sent message springs up from the composer: from 0.6 at its bottom-right corner, the confirm spring (380 ms, damping 0.72). */
const springIn = () => {
  "worklet";
  return { initialValues: { opacity: 0, transform: [{ translateY: 24 }, { scale: 0.6 }] },
    animations: { opacity: withTiming(1, { duration: 160 }), transform: [{ translateY: withSpring(0, { duration: 380, dampingRatio: 0.72 }) }, { scale: withSpring(1, { duration: 380, dampingRatio: 0.72 }) }] } };
};
/** The status line and the safety card rise 8 pt into place, after the bubble has landed. */
const rise = (delay: number) => () => {
  "worklet";
  return { initialValues: { opacity: 0, transform: [{ translateY: 8 }] },
    animations: { opacity: withDelay(delay, withTiming(1, { duration: 300 })), transform: [{ translateY: withDelay(delay, withTiming(0, { duration: 300 })) }] } };
};
