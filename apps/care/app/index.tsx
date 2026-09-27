import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useRef } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { todayOf } from "@/features/check-ins/model";
import { TodayCard, useCheckIns } from "@/features/check-ins/today";
import { DischargeRow } from "@/features/discharge/row";
import { DoseTile, useNextDose, useNow, WeekCard } from "@/features/doses";
import { clock, dueNow } from "@/features/doses/model";
import { away } from "@/features/follow-ups/lines";
import { useFollowUps, VisitTile } from "@/features/follow-ups/row";
import { checkInsLine, daysHome, needsLine, whereWords, type Need } from "@/features/home";
import { useMe } from "@/features/me";
import { CareTeamRow, useMessageNeeds } from "@/features/messages/row";
import { Welcome } from "@/features/sign-in/welcome";
import { authClient } from "@/lib/auth-client";
import { DOCK_SPACE } from "@/lib/dock";
import { palette, type } from "@/lib/theme";
import { Button, Card, Chip, Section, Title } from "@/lib/ui";
import { orpc } from "@/utils/orpc";

/** Every open thing on home, in the order it's shown as a chip; each chip jumps to or opens its thing. */
function useNeeds(): (Need & { dot: string })[] {
  const now = useNow();
  const { dose } = useNextDose(now);
  const checkIns = useCheckIns();
  const ask = checkIns.data && todayOf(checkIns.data, now).ask;
  const reply = useMessageNeeds();
  const visits = useFollowUps().data?.filter(f => f.status !== "upcoming") ?? [];
  return [
    ...(dose && dueNow(dose.dueAt, now) ? [{ kind: "dose" as const, label: `${dose.name} · ${clock(dose.dueAt)}`, dot: palette.amber }] : []),
    ...(ask ? [{ kind: "check-in" as const, label: `Day ${ask.day} check-in`, dot: palette.amber }] : []),
    ...(reply ? [{ kind: "reply" as const, label: "Care team replied", dot: palette.blue }] : []),
    ...visits.map(f => ({ kind: "visit" as const, label: `${f.short} · ${f.status === "overdue" ? "overdue" : away(f.inDays)}`, dot: f.status === "overdue" ? palette.red : palette.amber })),
  ];
}

/**
 * Sona Care's home answers, in order: where am I and does anything need me (the title, its line with a
 * time estimate, and a chip per open thing), what's next (the medicine card, logged in place, and the
 * visit card), the one feature card (today's check-in), how this week went, then the plan and care team.
 */
export default function Home() {
  const { state, me } = useMe();
  const needs = useNeeds();
  const checkIns = useCheckIns();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollView>(null);
  const spots = useRef({ up: 0, today: 0 });
  const health = useQuery(orpc.healthCheck.queryOptions());
  const offline = health.isError || (health.data !== undefined && health.data !== "OK");
  if (state === "signed-out") return <Welcome />;
  const layout = reduced ? undefined : LinearTransition.springify().duration(380).dampingRatio(1);
  const jump = (to: keyof typeof spots.current) => scroll.current?.scrollTo({ y: Math.max(0, spots.current[to] - insets.top - 12), animated: !reduced });
  const go = (kind: Need["kind"]) => kind === "dose" ? jump("up") : kind === "check-in" ? jump("today") : router.push(kind === "reply" ? "/messages" : "/follow-ups");
  const where = me && whereWords(daysHome(me.dischargedAt));
  return <ScrollView ref={scroll} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingTop: 16, paddingBottom: DOCK_SPACE, gap: 16 }}>
    {state === "joined" && me && where
      ? <View style={{ gap: 10 }}>
        <Title greeting={`Hello! ${me.firstName}`} accent={where[0]} line={needsLine(needs)} lineTone={needs.length ? "amber" : "green"}>{where[1]}</Title>
        {needs.length > 0 && <Animated.View layout={layout} exiting={FadeOut.duration(200)} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {needs.map(n => <Animated.View key={`${n.kind}:${n.label}`} layout={layout} entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)}>
            <Chip label={n.label} dot={n.dot} onPress={() => go(n.kind)} />
          </Animated.View>)}
        </Animated.View>}
      </View>
      : <Title overline="Sona Care" line="Check-ins, your discharge plan and follow-ups, from your hospital.">Your care, between visits</Title>}
    {offline && <Text style={{ ...type.footnote, color: palette.amber }}>Offline · showing what was last saved</Text>}
    {state === "loading" && <ActivityIndicator color={palette.muted} />}
    {state === "not-joined" && <Card feature>
      <Text style={{ ...type.headline, color: palette.ink }}>Link your hospital record</Text>
      <Text style={{ ...type.body, color: palette.muted }}>Use the code on your discharge paper so Sona Care shows your own care.</Text>
      <Button label="Enter my discharge code" onPress={() => router.push("/join")} />
    </Card>}
    {state === "joined" && <>
      <Section light="Up" bold="next" />
      <View onLayout={e => { spots.current.up = e.nativeEvent.layout.y; }} style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <DoseTile />
        <VisitTile />
      </View>
      <Section light="Today's" bold="check-in" />
      <View onLayout={e => { spots.current.today = e.nativeEvent.layout.y; }}><TodayCard /></View>
      <WeekCard also={checkInsLine(checkIns.data)} />
      <Card style={{ paddingVertical: 6 }}>
        <DischargeRow first />
        <CareTeamRow />
      </Card>
    </>}
    {state !== "loading" && <Pressable accessibilityRole="button" onPress={() => { void authClient.signOut(); }} style={{ alignSelf: "center", minHeight: 44, minWidth: 44, justifyContent: "center" }}>
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>Sign out</Text>
    </Pressable>}
  </ScrollView>;
}
