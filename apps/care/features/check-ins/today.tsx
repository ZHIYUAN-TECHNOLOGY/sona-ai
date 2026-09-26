import { useMutation, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import Animated, { FadeIn, LinearTransition, useReducedMotion } from "react-native-reanimated";
import { errorText } from "@/features/errors";
import { useMe } from "@/features/me";
import { palette, type } from "@/lib/theme";
import { Button, Card, field } from "@/lib/ui";
import { client, orpc, queryClient } from "@/utils/orpc";
import { useMessageNeeds, useThread } from "@/features/messages/row";
import { Answer } from "./answer";
import { answersFor, doneLine, shortDate, todayOf, type ReplyLabel } from "./model";

/**
 * Home's feature card: the check-in waiting for the patient, answered in place (three quick answers,
 * or their own words), then a done line saying who was told. Otherwise the next check-in, calmly.
 * `useCheckInNeeds` counts toward the home's insight line.
 */
export function useCheckIns() {
  const { state } = useMe();
  return useQuery({ ...orpc.care.checkIns.list.queryOptions(), enabled: state === "joined" });
}

export function useCheckInNeeds() {
  const { data } = useCheckIns();
  return data && todayOf(data, new Date()).ask ? 1 : 0;
}

export function TodayCard() {
  const thread = useThread();
  const replyWaiting = useMessageNeeds() > 0;
  const { data, isError } = useCheckIns();
  const reduced = useReducedMotion();
  const [done, setDone] = useState<ReplyLabel>();
  const [writing, setWriting] = useState(false);
  const [words, setWords] = useState("");
  const reply = useMutation({
    mutationFn: (input: { checkInId: string; text: string }) => client.care.checkIns.reply(input),
    onSuccess: checkIn => {
      const label = checkIn.replies.at(-1)!.label;
      setDone(label);
      AccessibilityInfo.announceForAccessibility(doneLine(label).text);
      void queryClient.invalidateQueries({ queryKey: orpc.care.checkIns.key() });
    },
  });
  const layout = reduced ? undefined : LinearTransition.duration(240);
  const enter = reduced ? undefined : FadeIn.duration(220);

  if (!data) return <Card feature>
    <Text style={{ ...type.overline, color: palette.blue }}>Today</Text>
    {isError ? <Text style={{ ...type.body, color: palette.muted }}>Your check-ins could not load. Try again in a moment.</Text> : <ActivityIndicator color={palette.muted} />}
  </Card>;

  const { ask, next } = todayOf(data, new Date());
  const past = data.some(c => c.replies.length);
  const history = past && <Pressable accessibilityRole="link" onPress={() => router.push("/check-ins")} style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}>
    <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>Past check-ins ›</Text>
  </Pressable>;

  if (done) {
    const line = doneLine(done);
    return <Card feature><Animated.View entering={enter} layout={layout} style={{ gap: 8 }}>
      <Text style={{ ...type.overline, color: palette.blue }}>Today</Text>
      <Text style={{ ...type.headline, color: palette.ink }}>Thank you</Text>
      <Text style={{ ...type.body, fontWeight: line.tone === "amber" ? "600" : "400", color: palette[line.tone] }}>{line.text}</Text>
      {history}
    </Animated.View></Card>;
  }

  if (ask) {
    const copy = answersFor(ask.language);
    const send = (text: string) => reply.mutate({ checkInId: ask.id, text });
    return <Card feature><Animated.View layout={layout} style={{ gap: 12 }}>
      <Text style={{ ...type.overline, color: palette.blue }}>Day {ask.day} check-in</Text>
      <View style={{ gap: 2 }}>
        <Text accessibilityRole="header" style={{ ...type.title, fontWeight: "600", color: palette.ink }}>{copy.question}</Text>
        {copy.english && <Text style={{ ...type.footnote, color: palette.muted }}>{copy.english}</Text>}
      </View>
      {writing
        ? <Animated.View entering={enter} style={{ gap: 10 }}>
          <TextInput value={words} onChangeText={setWords} placeholder={copy.placeholder} placeholderTextColor={palette.muted} multiline autoFocus maxLength={1000}
            accessibilityLabel={copy.more} style={{ ...field, minHeight: 96, paddingTop: 12, textAlignVertical: "top" }} />
          <Button label={copy.send} busy={reply.isPending} disabled={!words.trim()} onPress={() => send(words.trim())} />
        </Animated.View>
        : <>
          <Answer language={ask.language} disabled={reply.isPending} onAnswer={text => send(text)} />
          <Pressable accessibilityRole="button" onPress={() => setWriting(true)} style={{ minHeight: 44, justifyContent: "center", alignSelf: "center" }}>
            <Text style={{ ...type.body, fontWeight: "600", color: palette.blue }}>{copy.more}</Text>
          </Pressable>
        </>}
      {reply.isPending && !writing && <ActivityIndicator color={palette.muted} />}
      {reply.error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{errorText(reply.error)}</Text>}
      <Text style={{ ...type.footnote, color: palette.muted }}>For an emergency, call 999.</Text>
    </Animated.View></Card>;
  }

  // Nothing to answer, but the care team replied: that reply is the one thing that needs them now.
  const lastReply = thread.data?.at(-1);
  if (replyWaiting && lastReply) return <Card feature>
    <Text style={{ ...type.overline, color: palette.blue }}>From your care team</Text>
    <Text numberOfLines={3} style={{ ...type.body, color: palette.ink }}>{lastReply.text}</Text>
    <Button label="Read and reply" onPress={() => router.push("/messages")} />
    {history}
  </Card>;

  return <Card feature>
    <Text style={{ ...type.overline, color: palette.blue }}>Today</Text>
    <Text style={{ ...type.headline, color: palette.ink }}>You're all set</Text>
    <Text style={{ ...type.body, color: palette.muted }}>
      {next ? `Next check-in ${shortDate(next.dueAt)}. We'll ask how you're feeling.`
        : data.length ? "Your check-ins are done. Message your care team any time."
          : "We'll ask how you're feeling on day 2 and day 7 after you go home."}
    </Text>
    {history}
  </Card>;
}
