import { useMutation } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, type ViewStyle } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { FadeIn, LayoutAnimationConfig, useReducedMotion, withDelay, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { errorText } from "@/features/errors";
import { useMe } from "@/features/me";
import { clockOf, type Message, REPLY_TIME, suggestions, whileYouWait, withDays } from "@/features/messages/model";
import { markRead, useThread } from "@/features/messages/row";
import { dawn, palette, type } from "@/lib/theme";
import { Card, field, pillStyle, surfaceStyle, Title } from "@/lib/ui";
import { client, orpc, queryClient } from "@/utils/orpc";

/**
 * The thread with the care team (after the Honk chat): the care team on the left with its avatar, the
 * patient on the right in ink, a day pill per day. A sent message springs up from the composer and is
 * followed by what happens next ("Sent · usually replies within a few hours"); a warning sign in it
 * adds what to do while waiting. Up to three likely replies sit over the composer and send in one tap.
 * The emergency line never leaves the screen. Re-read every 15 s while open.
 */
const REFETCH_MS = 15_000;
const newRequestId = () => `care-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
type Draft = { text: string; requestId: string; at: Date };

export default function Messages() {
  const { data, error } = useThread(REFETCH_MS);
  const { me } = useMe();
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
      AccessibilityInfo.announceForAccessibility(`Sent. ${REPLY_TIME}.`);
    },
  });
  const go = (words: string) => {
    const t = words.trim();
    if (!t || send.isPending) return;
    const requestId = t === attempt.text ? attempt.requestId : newRequestId();
    setAttempt({ text: t, requestId });
    if (process.env.EXPO_OS === "ios") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    send.mutate({ text: t, requestId, at: new Date() });
  };

  // While sending, the message shows under the ID the server will give it (see care.messages.send).
  const sending = send.isPending && send.variables && me ? { id: `message:${me.patientId}:${send.variables.requestId}`, from: "patient" as const, text: send.variables.text, createdAt: send.variables.at } : undefined;
  const thread: Message[] = data ? (sending && !data.some(m => m.id === sending.id) ? [...data, sending] : data) : [];
  const last = thread.at(-1);
  const wait = whileYouWait(thread);
  const picks = text.trim() || send.isPending ? [] : suggestions(thread);
  const lastId = data?.at(-1)?.id;
  useEffect(() => { if (lastId) markRead(lastId); }, [lastId]);

  return <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
    <ScrollView ref={scroll} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive" onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
      contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Title overline={me?.hospital} line={REPLY_TIME}>Your care team</Title>
      {!data ? (error ? <Text selectable style={{ ...type.footnote, color: palette.red }}>{errorText(error)}</Text> : <ActivityIndicator color={palette.muted} />)
        // Messages there on opening appear still; only what arrives while the screen is open moves.
        : <LayoutAnimationConfig skipEntering><View style={{ gap: 14, paddingTop: 8 }}>
          {!thread.length && <Card><Text style={{ ...type.body, color: palette.muted }}>Ask anything about your recovery. Your care team will reply here.</Text></Card>}
          {withDays(thread, new Date()).map(item => "day" in item
            ? <Pill key={`day-${item.day}`} label={item.day} />
            : <Bubble key={item.message.id} m={item.message} sending={item.message.id === sending?.id} reduced={reduced} />)}
          {last?.from === "patient" && <Animated.View key={`status-${last.id}`} entering={reduced ? FadeIn.duration(200) : rise(250)} style={{ alignSelf: "center" }}>
            <Pill label={last.id === sending?.id ? "Sending…" : `Sent · ${REPLY_TIME.toLowerCase()}`} />
          </Animated.View>}
          {wait && <Animated.View key={`wait-${last!.id}`} entering={reduced ? FadeIn.duration(200) : rise(400)} accessible accessibilityLabel={`While you wait. ${wait} If you faint or have chest pain, call 999.`}
            style={{ borderRadius: 20, borderCurve: "continuous", padding: 14, gap: 6, backgroundColor: "#FFF3E7", borderWidth: 1, borderColor: "#F6DCC2" }}>
            <Text style={{ ...type.headline, color: palette.amber }}>While you wait</Text>
            <Text style={{ ...type.body, color: palette.ink }}>{wait}</Text>
            <Text style={{ ...type.body, fontWeight: "700", color: palette.red }}>If you faint or have chest pain, call 999.</Text>
          </Animated.View>}
        </View></LayoutAnimationConfig>}
    </ScrollView>

    <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 12), gap: 8 }}>
      {data && picks.length > 0 && <Animated.View key={picks.join("|")} entering={FadeIn.duration(220)} style={{ gap: 6 }}>
        {picks.map(p => <Pressable key={p} accessibilityRole="button" accessibilityLabel={p} accessibilityHint="Sends this to your care team" onPress={() => go(p)}
          style={({ pressed }) => [pillStyle, { minHeight: 44, borderRadius: 16, borderCurve: "continuous", paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
          <Text style={{ flex: 1, fontSize: 14, lineHeight: 19, fontWeight: "600", color: palette.ink }}>{p}</Text>
          <Text style={{ fontSize: 15, color: palette.muted }}>↗</Text>
        </Pressable>)}
      </Animated.View>}
      {send.error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{errorText(send.error)}</Text>}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
        <TextInput value={text} onChangeText={setText} placeholder="Write to your care team" placeholderTextColor={palette.muted} multiline maxLength={1000}
          accessibilityLabel="Message to your care team" style={{ ...field, flex: 1, minHeight: 48, maxHeight: 140, borderRadius: 24, paddingTop: 13, paddingBottom: 13 }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Send" accessibilityState={{ disabled: !text.trim(), busy: send.isPending }} disabled={!text.trim() || send.isPending} onPress={() => go(text)}
          style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: palette.dark, opacity: text.trim() ? 1 : 0.45, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
          {send.isPending ? <ActivityIndicator color={palette.white} />
            : <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={palette.white} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><Path d="M12 19V5M5 12l7-7 7 7" /></Svg>}
        </Pressable>
      </View>
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.amber, textAlign: "center" }}>Not for emergencies · call 999</Text>
    </View>
  </KeyboardAvoidingView>;
}

/** A small glass capsule in the thread: a day, or what happens next. */
function Pill({ label }: { label: string }) {
  return <View style={[pillStyle, { alignSelf: "center", paddingHorizontal: 12, paddingVertical: 5 }]}>
    <Text style={{ ...type.footnote, fontSize: 12, color: palette.muted }}>{label}</Text>
  </View>;
}

function Bubble({ m, sending, reduced }: { m: Message; sending: boolean; reduced: boolean }) {
  const mine = m.from === "patient";
  const who = mine ? "You" : "Care team";
  const tail: ViewStyle = mine ? { borderBottomRightRadius: 8 } : { borderBottomLeftRadius: 8 };
  return <Animated.View entering={reduced ? FadeIn.duration(200) : mine ? springIn : FadeIn.duration(240)} accessible accessibilityLabel={`${who}, ${sending ? "sending" : clockOf(m.createdAt)}: ${m.text}`}
    style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "86%", flexDirection: "row", alignItems: "flex-end", gap: 8, transformOrigin: "right bottom" }}>
    {!mine && <Avatar />}
    <View style={{ flexShrink: 1, gap: 4, alignItems: mine ? "flex-end" : "flex-start" }}>
      <View style={[mine ? { backgroundColor: palette.dark, borderRadius: 22, borderCurve: "continuous" } : { ...surfaceStyle, borderRadius: 22 }, tail, { paddingHorizontal: 14, paddingVertical: 11 }]}>
        <Text selectable style={{ ...type.body, color: mine ? palette.white : palette.ink }}>{m.text}</Text>
      </View>
      <Text style={{ fontSize: 11, lineHeight: 15, color: palette.muted }}>{who} · {sending ? "Sending…" : clockOf(m.createdAt)}</Text>
    </View>
  </Animated.View>;
}

/** The care team's mark: a heart on the Dawn gradient (the thread names no one, so no initials). */
function Avatar() {
  return <View style={{ width: 30, height: 30, borderRadius: 15, marginBottom: 19, alignItems: "center", justifyContent: "center", experimental_backgroundImage: `linear-gradient(135deg, ${dawn[0]}, ${dawn[1]} 55%, ${dawn[2]})` } as ViewStyle}>
    <Svg width={15} height={15} viewBox="0 0 24 24" fill={palette.white}><Path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" /></Svg>
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
