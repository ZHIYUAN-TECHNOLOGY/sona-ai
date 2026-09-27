import { useMutation, useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, Text, View, type ViewStyle } from "react-native";
import Animated, { FadeIn, LinearTransition, useReducedMotion } from "react-native-reanimated";
import { errorText } from "@/features/errors";
import { useMe } from "@/features/me";
import { useMessageNeeds, useThread } from "@/features/messages/row";
import { Sunbeam } from "@/lib/halftone";
import { palette, type } from "@/lib/theme";
import { Button, Card } from "@/lib/ui";
import { client, orpc, queryClient } from "@/utils/orpc";
import { Answer, TINT } from "./answer";
import { answersFor, doneLine, shortDate, todayOf, type Feeling, type ReplyLabel } from "./model";

/**
 * Home's feature card: the check-in waiting for the patient, answered in place (a tinted pill opens
 * into quick replies, or their own words), then a done line saying who was told and when they call.
 * Otherwise the care team's waiting reply, or the next check-in, calmly. `useCheckInNeeds` counts
 * toward the home's insight line.
 */
export function useCheckIns() {
  const { state } = useMe();
  return useQuery({ ...orpc.care.checkIns.list.queryOptions(), enabled: state === "joined" });
}

export function useCheckInNeeds() {
  const { data } = useCheckIns();
  return data && todayOf(data, new Date()).ask ? 1 : 0;
}

/** The card's ambient light, tinted to the chosen answer and rising from the bottom edge. */
function Glow({ feeling }: { feeling: Feeling }) {
  return <Animated.View entering={FadeIn.duration(500)} pointerEvents="none"
    style={{ position: "absolute", inset: 0, borderRadius: 27, experimental_backgroundImage: `radial-gradient(ellipse at 50% 100%, ${TINT[feeling].glow}, transparent 70%)` } as ViewStyle} />;
}

type Done = { checkInId: string; day: number; label: ReplyLabel; feeling?: Feeling; about?: string };

export function TodayCard() {
  const thread = useThread();
  const replyWaiting = useMessageNeeds() > 0;
  const { data, isError } = useCheckIns();
  const reduced = useReducedMotion();
  const [feeling, setFeeling] = useState<Feeling>();
  const [done, setDone] = useState<Done>();
  const reply = useMutation({
    mutationFn: ({ checkInId, text }: Omit<Done, "label"> & { text: string }) => client.care.checkIns.reply({ checkInId, text }),
    onSuccess: (checkIn, { day, feeling, about }) => {
      const label = checkIn.replies.at(-1)!.label, line = doneLine(label, about);
      setDone({ checkInId: checkIn.id, day, label, feeling, about });
      if (process.env.EXPO_OS === "ios") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility(`${line.title}. ${line.text}`);
      void queryClient.invalidateQueries({ queryKey: orpc.care.checkIns.key() });
    },
  });
  const layout = reduced ? undefined : LinearTransition.springify().duration(380).dampingRatio(1);
  const overline = (text: string) => <Text style={{ ...type.overline, color: palette.blue }}>{text}</Text>;
  const link = (label: string, to: "/check-ins" | "/messages") => <Pressable accessibilityRole="link" onPress={() => router.push(to)} style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}>
    <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>{label} ›</Text>
  </Pressable>;

  if (!data) return <Card feature>
    {overline("Today")}
    {isError ? <Text style={{ ...type.body, color: palette.muted }}>Your check-ins could not load. Try again in a moment.</Text> : <ActivityIndicator color={palette.muted} style={{ alignSelf: "flex-start" }} />}
  </Card>;

  const { ask, next } = todayOf(data, new Date());
  const history = data.some(c => c.replies.length) && link("Past check-ins", "/check-ins");

  // Sent: who was told and when they will call, then the next check-in. The sunbeam only for a calm answer.
  if (done) {
    const line = doneLine(done.label, done.about), after = data.find(c => !c.replies.length && c.id !== done.checkInId);
    const calm = line.tone === "muted";
    return <Card feature>
      {done.feeling && <Glow feeling={done.feeling} />}
      <Animated.View entering={reduced ? undefined : FadeIn.duration(240)} style={{ gap: 8 }}>
        {overline(`Day ${done.day} check-in · done`)}
        <Text accessibilityRole="header" style={{ ...type.title, fontWeight: "700", color: palette.ink }}>{line.title}</Text>
        <Text style={{ ...type.body, fontWeight: calm ? "400" : "600", color: calm ? palette.muted : palette.amber }}>{line.text}</Text>
        {!calm && <Text style={{ ...type.footnote, fontWeight: "700", color: palette.red }}>Severe chest pain or can't breathe? Call 999 now.</Text>}
        <Text style={{ ...type.footnote, color: palette.muted }}>{after ? `Next check-in ${shortDate(after.dueAt)}.` : "That was your last check-in. Message your care team any time."}</Text>
        {link("Past check-ins", "/check-ins")}
      </Animated.View>
      {calm && <Sunbeam play={done} radius={27} />}
    </Card>;
  }

  if (ask) {
    const copy = answersFor(ask.language);
    return <Card feature>
      {feeling && <Glow feeling={feeling} />}
      <Animated.View layout={layout} style={{ gap: 12 }}>
        {overline(`Day ${ask.day} check-in · takes 10 seconds`)}
        <View style={{ gap: 2 }}>
          <Text accessibilityRole="header" style={{ ...type.title, fontWeight: "700", color: palette.ink }}>{copy.question}</Text>
          {copy.english && <Text style={{ ...type.footnote, color: palette.muted }}>{copy.english}</Text>}
        </View>
        <Answer language={ask.language} feeling={feeling} onChoose={setFeeling} busy={reply.isPending}
          onSend={(text, about) => reply.mutate({ checkInId: ask.id, day: ask.day, feeling, text, about })} />
        {reply.error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{errorText(reply.error)}</Text>}
        {feeling !== "worse" && <Text style={{ ...type.footnote, color: palette.muted }}>For an emergency, call 999.</Text>}
      </Animated.View>
    </Card>;
  }

  // Nothing to answer, but the care team replied: that reply is the one thing that needs them now.
  const lastReply = thread.data?.at(-1);
  if (replyWaiting && lastReply) return <Card feature>
    {overline("From your care team")}
    <Text numberOfLines={3} style={{ ...type.body, color: palette.ink }}>{lastReply.text}</Text>
    <Button label="Read and reply" onPress={() => router.push("/messages")} />
    {history}
  </Card>;

  return <Card feature>
    {overline("Today")}
    <Text accessibilityRole="header" style={{ ...type.title, fontWeight: "700", color: palette.ink }}>You're all set</Text>
    <Text style={{ ...type.body, color: palette.muted }}>
      {next ? `Next check-in ${shortDate(next.dueAt)}. We'll ask how you're feeling.`
        : data.length ? "Your check-ins are done. Message your care team any time."
          : "We'll ask how you're feeling on day 2 and day 7 after you go home."}
    </Text>
    {history}
  </Card>;
}
