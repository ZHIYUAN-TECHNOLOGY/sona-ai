import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useRef } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { todayOf } from "@/features/check-ins/model";
import { TodayCard, useCheckIns } from "@/features/check-ins/today";
import { ConsistencyCard, KICKER, MedsCard, Tile, useNextDose, useNow } from "@/features/doses";
import { clock, dueNow } from "@/features/doses/model";
import { away } from "@/features/follow-ups/lines";
import { useFollowUps, VisitTile } from "@/features/follow-ups/row";
import { headerDate, latestLine, needsLine, type Need } from "@/features/home";
import { useMe } from "@/features/me";
import { useMessageNeeds, useThread } from "@/features/messages/row";
import { Welcome } from "@/features/sign-in/welcome";
import { authClient } from "@/lib/auth-client";
import { DOCK_SPACE } from "@/lib/dock";
import { palette, type } from "@/lib/theme";
import { AccentText, Button, Card, Chip, CircleButton, ICON, Section, Title } from "@/lib/ui";
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

const HEART = "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z";

/** Home's short "Latest update" card: the care team's waiting reply, a sent message's status, or green reassurance; the 999 line always. Opens the thread. */
function LatestCard({ index, calm }: { index: number; calm: boolean }) {
  const { data } = useThread();
  const unread = useMessageNeeds() > 0;
  const l = latestLine(data, unread, calm);
  const color = l.tone === "ink" ? palette.ink : palette[l.tone];
  return <Tile index={index} label={`Latest update. ${l.lead ? `${l.lead}: ` : ""}${l.text.replace("✦ ", "")}. Not for emergencies, call 999. Open messages`} onPress={() => router.push("/messages")}>
    <Text style={KICKER}>Latest update</Text>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: palette.white }}>
        <Svg width={17} height={17} viewBox="0 0 24 24"><Path d={HEART} fill="none" stroke={l.tone === "ink" ? palette.blue : color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></Svg>
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        {l.lead && <Text style={{ fontSize: 12, lineHeight: 16, fontWeight: "700", color: l.tone === "ink" ? palette.blue : palette.muted }}>{l.lead}</Text>}
        <Text numberOfLines={3} style={{ fontSize: 14, lineHeight: 19, fontWeight: "600", color }}>{l.text}</Text>
      </View>
    </View>
    <Text style={{ ...type.footnote, color: palette.muted }}>Not for emergencies · call 999</Text>
  </Tile>;
}

/**
 * Sona Care's home (Lumi kit frame 1), answering in order: who and when (initials, greeting, date, and
 * the bell with a dot when the care team replied), does anything need me ("Today's updates", its line
 * with a time estimate, a chip per open thing), a bento of glance cards (today's medicines with the
 * hold to log one in place, consistency, the latest update, the next visit), then the one feature card,
 * today's check-in. At large Dynamic Type the bento's two columns stack.
 */
export default function Home() {
  const { state, me } = useMe();
  const needs = useNeeds();
  const now = useNow();
  const reply = useMessageNeeds() > 0;
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const scroll = useRef<ScrollView>(null);
  const spots = useRef({ up: 0, today: 0 });
  const health = useQuery(orpc.healthCheck.queryOptions());
  const offline = health.isError || (health.data !== undefined && health.data !== "OK");
  if (state === "signed-out") return <Welcome />;
  const layout = reduced ? undefined : LinearTransition.springify().duration(380).dampingRatio(1);
  const jump = (to: keyof typeof spots.current) => scroll.current?.scrollTo({ y: Math.max(0, spots.current[to] - insets.top - 12), animated: !reduced });
  const go = (kind: Need["kind"]) => kind === "dose" ? jump("up") : kind === "check-in" ? jump("today") : router.push(kind === "reply" ? "/messages" : "/follow-ups");
  const stack = fontScale >= 1.35;
  const column = stack ? { gap: 12 } : { flex: 1, gap: 12 };
  const line = needsLine(needs);
  return <ScrollView ref={scroll} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: DOCK_SPACE, gap: 16 }}>
    {state === "joined" && me
      ? <>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: palette.blueWash, borderWidth: 1.5, borderColor: palette.white }}>
            <Text style={{ fontSize: 17, fontWeight: "700", color: palette.blue }}>{me.firstName.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View accessible accessibilityRole="header" accessibilityLabel={`Hello ${me.firstName}. ${headerDate(now)}`} style={{ flex: 1, alignItems: "center" }}>
            <Text style={{ ...type.footnote, color: palette.faint }}>Hello! {me.firstName}</Text>
            <Text style={{ ...type.headline, color: palette.ink }}>{headerDate(now)}</Text>
          </View>
          <CircleButton d={ICON.bell} dot={reply} label={reply ? "Messages. Your care team replied" : "Messages from my care team"} onPress={() => router.push("/messages")} />
        </View>
        <View style={{ gap: 10 }}>
          <View accessible accessibilityRole="header" accessibilityLabel={`Today's updates. ${line}`} style={{ marginTop: 4 }}>
            <Text style={{ fontSize: 18, lineHeight: 22, fontWeight: "300", color: palette.faint, letterSpacing: -0.3 }}>Today's</Text>
            <View style={{ alignSelf: "flex-start" }}><AccentText style={{ fontSize: 24, lineHeight: 29, fontWeight: "600", letterSpacing: -0.7 }}>updates</AccentText></View>
            <Text style={{ ...type.body, fontWeight: "600", color: needs.length ? palette.amber : palette.green, marginTop: 4 }}>{line}</Text>
          </View>
          {needs.length > 0 && <Animated.View layout={layout} exiting={FadeOut.duration(200)} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {needs.map(n => <Animated.View key={`${n.kind}:${n.label}`} layout={layout} entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)}>
              <Chip label={n.label} dot={n.dot} onPress={() => go(n.kind)} />
            </Animated.View>)}
          </Animated.View>}
        </View>
      </>
      : <Title overline="Sona Care" line="Check-ins, your discharge plan and follow-ups, from your hospital.">Your care, between visits</Title>}
    {offline && <Text style={{ ...type.footnote, color: palette.amber }}>Offline · showing what was last saved</Text>}
    {state === "loading" && <ActivityIndicator color={palette.muted} />}
    {state === "not-joined" && <Card feature>
      <Text style={{ ...type.headline, color: palette.ink }}>Link your hospital record</Text>
      <Text style={{ ...type.body, color: palette.muted }}>Use the code on your discharge paper so Sona Care shows your own care.</Text>
      <Button label="Enter my discharge code" onPress={() => router.push("/join")} />
    </Card>}
    {state === "joined" && <>
      <View onLayout={e => { spots.current.up = e.nativeEvent.layout.y; }} style={{ flexDirection: stack ? "column" : "row", gap: 12 }}>
        <View style={column}>
          <MedsCard index={0} />
          <LatestCard index={2} calm={!needs.length} />
        </View>
        <View style={column}>
          <ConsistencyCard index={1} />
          <VisitTile index={3} />
        </View>
      </View>
      <Section light="Today's" bold="check-in" />
      <View onLayout={e => { spots.current.today = e.nativeEvent.layout.y; }}><TodayCard /></View>
    </>}
    {state !== "loading" && <Pressable accessibilityRole="button" onPress={() => { void authClient.signOut(); }} style={{ alignSelf: "center", minHeight: 44, minWidth: 44, justifyContent: "center" }}>
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>Sign out</Text>
    </Pressable>}
  </ScrollView>;
}
