import { useMutation, useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, View, type ViewStyle } from "react-native";
import { Text } from "@/lib/text";
import Animated, { FadeIn, LinearTransition, useReducedMotion } from "react-native-reanimated";
import { errorText } from "@/features/errors";
import { useMe } from "@/features/me";
import { useMessageNeeds, useThread } from "@/features/messages/row";
import { Sunbeam } from "@/lib/halftone";
import { palette, type } from "@/lib/theme";
import { Button, Card, pillStyle } from "@/lib/ui";
import { client, orpc, queryClient } from "@/utils/orpc";
import { Answer, TINT } from "./answer";
import { answersFor, doneLine, shortDate, todayOf, type Feeling, type ReplyLabel } from "./model";
import { now as clockNow } from "@/lib/clock";
import { tFor, useLang } from "@/lib/i18n";
import "./strings";

/**
 * Home's feature card: the check-in waiting for the patient, answered in place (the kit's five faces;
 * the chosen one opens into quick replies, or their own words), then a done line saying who was told and when they call.
 * Otherwise the care team's waiting reply, or the next check-in, calmly. `useCheckInNeeds` counts
 * toward the home's insight line.
 */
export function useCheckIns() {
  const { state } = useMe();
  return useQuery({ ...orpc.care.checkIns.list.queryOptions(), enabled: state === "joined" });
}

export function useCheckInNeeds() {
  const { data } = useCheckIns();
  return data && todayOf(data, clockNow()).ask ? 1 : 0;
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
  const { data, isError, isFetching, refetch } = useCheckIns();
  const lang = useLang(), t = tFor(lang);
  const reduced = useReducedMotion();
  const [feeling, setFeeling] = useState<Feeling>();
  const [done, setDone] = useState<Done>();
  const reply = useMutation({
    mutationFn: ({ checkInId, text }: Omit<Done, "label"> & { text: string }) => client.care.checkIns.reply({ checkInId, text }),
    onSuccess: (checkIn, { day, feeling, about }) => {
      const label = checkIn.replies.at(-1)!.label, line = doneLine(label, about, lang);
      setDone({ checkInId: checkIn.id, day, label, feeling, about });
      if (process.env.EXPO_OS === "ios") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility(`${line.title}. ${line.text}`);
      void queryClient.invalidateQueries({ queryKey: orpc.care.checkIns.key() });
    },
  });
  const layout = reduced ? undefined : LinearTransition.springify().duration(380).dampingRatio(1);
  // The kit's white capsule for what this is and when ("Day 2 check-in · 10 seconds").
  const overline = (text: string) => <View style={[pillStyle, { alignSelf: "flex-start", minHeight: 28, paddingHorizontal: 11, justifyContent: "center" }]}>
    <Text maxFontSizeMultiplier={1.4} style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>{text}</Text>
  </View>;
  const head = { fontSize: 24, lineHeight: 30, letterSpacing: -1, fontWeight: "600", color: palette.ink } as const;
  const link = (label: string, to: "/check-ins" | "/messages") => <Pressable accessibilityRole="link" onPress={() => router.push(to)} style={{ minHeight: 48, justifyContent: "center", alignSelf: "flex-start" }}>
    <Text style={{ ...type.body, fontWeight: "600", color: palette.blue }}>{label}</Text>
  </Pressable>;

  if (!data) return <Card feature>
    {overline(t("ci.today"))}
    {isError ? <>
      <Text style={{ ...type.body, color: palette.muted }}>{t("ci.couldNotLoad")}</Text>
      <Button quiet label={t("common.retry")} busy={isFetching} onPress={() => { void refetch(); }} />
    </> : <ActivityIndicator color={palette.muted} style={{ alignSelf: "flex-start" }} />}
  </Card>;

  const { ask, next } = todayOf(data, clockNow());
  const history = data.some(c => c.replies.length) && link(t("ci.past"), "/check-ins");
  // The answer words follow the language Sona Care speaks (the plan's, unless the patient picked another).
  const copy = answersFor(lang);

  // Sent: who was told and when they will call, then the next check-in. The sunbeam only for a calm answer.
  if (done) {
    const line = doneLine(done.label, done.about, lang), after = data.find(c => !c.replies.length && c.id !== done.checkInId);
    const calm = line.tone === "muted";
    return <Card feature>
      {done.feeling && <Glow feeling={done.feeling} />}
      <Animated.View entering={reduced ? undefined : FadeIn.duration(240)} style={{ gap: 8 }}>
        {overline(t("ci.done", { title: t("checkin.title", { day: done.day }) }))}
        <Text accessibilityRole="header" style={head}>{line.title}</Text>
        <Text style={{ ...type.body, fontWeight: calm ? "400" : "600", color: calm ? palette.muted : palette.amber }}>{line.text}</Text>
        {!calm && <Text style={{ ...type.footnote, fontWeight: "700", color: palette.red }}>{copy.urgent}</Text>}
        <Text style={{ ...type.footnote, color: palette.muted }}>{after ? t("ci.nextCheckIn", { day: shortDate(after.dueAt, lang) }) : t("ci.last")}</Text>
        {link(t("ci.past"), "/check-ins")}
      </Animated.View>
      {calm && <Sunbeam play={done} radius={27} />}
    </Card>;
  }

  if (ask) {
    return <Card feature>
      {feeling && <Glow feeling={feeling} />}
      <Animated.View layout={layout} style={{ gap: 12 }}>
        {overline(t("ci.seconds", { title: t("checkin.title", { day: ask.day }) }))}
        <View style={{ gap: 2 }}>
          <Text accessibilityRole="header" style={head}>{copy.question}</Text>
          {copy.english && <Text style={{ ...type.footnote, color: palette.muted }}>{copy.english}</Text>}
        </View>
        <Answer language={lang} feeling={feeling} onChoose={setFeeling} busy={reply.isPending}
          onSend={(text, about) => reply.mutate({ checkInId: ask.id, day: ask.day, feeling, text, about })} />
        {reply.error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{errorText(reply.error, lang)}</Text>}
        {feeling !== "worse" && <Text style={{ ...type.footnote, color: palette.muted }}>{copy.emergency}</Text>}
      </Animated.View>
    </Card>;
  }

  // Nothing to answer, but the care team replied: that reply is the one thing that needs them now.
  const lastReply = thread.data?.at(-1);
  if (replyWaiting && lastReply) return <Card feature>
    {overline(t("ci.fromTeam"))}
    <Text numberOfLines={3} style={{ ...type.body, color: palette.ink }}>{lastReply.text}</Text>
    <Button label={t("ci.readReply")} onPress={() => router.push("/messages")} />
    {history}
  </Card>;

  return <Card feature>
    {overline(t("ci.today"))}
    <Text accessibilityRole="header" style={head}>{t("ci.allSet")}</Text>
    <Text style={{ ...type.body, color: palette.muted }}>
      {next ? t("ci.nextAsk", { day: shortDate(next.dueAt, lang) }) : data.length ? t("ci.allDone") : t("ci.willAsk")}
    </Text>
    {history}
  </Card>;
}
