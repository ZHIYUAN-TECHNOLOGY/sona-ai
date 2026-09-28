import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View, type LayoutChangeEvent } from "react-native";
import { Text } from "@/lib/text";
import Animated, { FadeIn, FadeOut, LinearTransition, useReducedMotion, withSpring, withTiming } from "react-native-reanimated";
import { KeyboardAwareScrollView, type KeyboardAwareScrollViewRef } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { todayOf } from "@/features/check-ins/model";
import { TodayCard, useCheckIns } from "@/features/check-ins/today";
import { rise, useNextDose, useNow } from "@/features/doses";
import { clock, dueNow } from "@/features/doses/model";
import { away } from "@/features/follow-ups/lines";
import { useFollowUps } from "@/features/follow-ups/row";
import { daysHome, headerDate, needsLine, type Need } from "@/features/home";
import { AddSheet } from "@/features/home/add-sheet";
import { ConsistencyTile, LatestTile, MedicinesTile, VisitTile } from "@/features/home/bento";
import { useMe } from "@/features/me";
import { useMessageNeeds } from "@/features/messages/row";
import { forgetPhone, NudgeCard } from "@/features/notifications";
import { Welcome } from "@/features/sign-in/welcome";
import { authClient } from "@/lib/auth-client";
import { DOCK_SPACE } from "@/lib/dock";
import { palette, space, type } from "@/lib/theme";
import { Button, Card, Chip, CircleButton, ICON, Section, Title } from "@/lib/ui";
import { orpc } from "@/utils/orpc";

/** Every open thing on home, most urgent first; each chip jumps to or opens its thing. */
function useNeeds(): (Need & { dot: string })[] {
  const now = useNow();
  const { dose } = useNextDose(now);
  const checkIns = useCheckIns();
  const ask = checkIns.data && todayOf(checkIns.data, now).ask;
  const reply = useMessageNeeds();
  const visits = useFollowUps().data?.filter(f => f.status !== "upcoming") ?? [];
  return [
    ...(dose && dueNow(dose.dueAt, now) ? [{ kind: "dose" as const, name: dose.name, label: `${dose.name} · ${clock(dose.dueAt)}`, dot: palette.warning }] : []),
    ...(ask ? [{ kind: "check-in" as const, label: `Day ${ask.day} check-in`, dot: palette.warning }] : []),
    ...(reply ? [{ kind: "reply" as const, label: "Care team replied", dot: palette.info }] : []),
    ...visits.map(f => ({ kind: "visit" as const, inDays: f.inDays, overdue: f.status === "overdue", label: `${f.short} · ${f.status === "overdue" ? "overdue" : away(f.inDays)}`, dot: f.status === "overdue" ? palette.error : palette.warning })),
  ];
}

/** The bell's count on the confirm spring: from 0.6, never from nothing. */
const pop = () => {
  "worklet";
  return { initialValues: { opacity: 0, transform: [{ scale: 0.6 }] }, animations: { opacity: withTiming(1, { duration: 160 }), transform: [{ scale: withSpring(1, { duration: 380, dampingRatio: 0.72 }) }] } };
};

/** The bento rises only the first time home appears in a session, not on every return to it. */
let seen = false;

/**
 * Sona Care's home (the kit's "Child Home", the patient watching their own recovery): initials, "Hello!
 * Amelia" over the date, and the bell with its count; then "Today's / Latest updates" with a + for
 * adding (ask, message, book), one insight line (day at home, what needs you and how long)
 * and a chip per open thing; a two-column bento (today's medicines with a hold to take the due dose in
 * place, consistency, the latest update, the next visit); and the one feature card, today's check-in.
 * At large Dynamic Type the bento stacks to one column.
 */
export default function Home() {
  const { state, me } = useMe();
  const needs = useNeeds();
  const now = useNow();
  const reply = useMessageNeeds() > 0;
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const scroll = useRef<KeyboardAwareScrollViewRef>(null);
  const spots = useRef({ cards: 0, today: 0 });
  const [adding, setAdding] = useState(false);
  const [still] = useState(() => seen);
  useEffect(() => { if (state === "joined") seen = true; }, [state]);
  const health = useQuery(orpc.healthCheck.queryOptions());
  const offline = health.isError || (health.data !== undefined && health.data !== "OK");
  if (state === "signed-out") return <Welcome />;
  const layout = reduced ? undefined : LinearTransition.springify().duration(380).dampingRatio(1);
  const spot = (to: keyof typeof spots.current) => (e: LayoutChangeEvent) => { spots.current[to] = e.nativeEvent.layout.y; };
  const jump = (to: keyof typeof spots.current) => scroll.current?.scrollTo({ y: Math.max(0, spots.current[to] - insets.top - 12), animated: !reduced });
  const go = (kind: Need["kind"]) => kind === "dose" ? jump("cards") : kind === "check-in" ? jump("today") : router.push(kind === "reply" ? "/messages" : "/follow-ups");
  const bell = () => reply || !needs[0] ? router.push("/messages") : go(needs[0].kind);
  const day = daysHome(me?.dischargedAt, now);
  const insight = day !== undefined ? `Day ${day} at home · ${needsLine(needs).replace(/^All/, "all")}` : needsLine(needs);
  const stack = fontScale >= 1.35;
  const calm = still || reduced;
  // Keyboard-aware: typing a check-in reply keeps the box and its Send button above the keyboard (bottomOffset covers the button under the box).
  return <KeyboardAwareScrollView ref={scroll} bottomOffset={140} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.edge, paddingTop: space.top, paddingBottom: DOCK_SPACE, gap: space.stack }}>
    {state === "joined" && me
      ? <>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View accessible accessibilityRole="image" accessibilityLabel={me.name} style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: palette.white }}>
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 16, fontWeight: "600", color: palette.blue }}>{me.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}</Text>
          </View>
          <View accessible accessibilityRole="header" style={{ flex: 1, alignItems: "center" }}>
            <Text numberOfLines={1} style={{ fontSize: 14, lineHeight: 19, color: palette.muted }}>Hello! {me.firstName}</Text>
            <Text numberOfLines={1} style={{ fontSize: 18, lineHeight: 24, fontWeight: "500", letterSpacing: -0.4, color: palette.ink }}>{headerDate(now)}</Text>
          </View>
          <View>
            <CircleButton d={ICON.bell} label={`Notifications. ${needsLine(needs)}`} onPress={bell} />
            {needs.length > 0 && <Animated.View key={needs.length} entering={reduced ? undefined : pop} pointerEvents="none"
              style={{ position: "absolute", top: -4, right: -4, minWidth: 20, minHeight: 20, paddingHorizontal: 5, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: palette.blue, borderWidth: 2, borderColor: palette.white }}>
              <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 11, lineHeight: 14, fontWeight: "700", color: palette.white, fontVariant: ["tabular-nums"] }}>{needs.length}</Text>
            </Animated.View>}
          </View>
        </View>
        <View style={{ gap: 10, marginTop: space.section - space.stack }}>
          <Section light="Today's" bold="Latest updates" action={<CircleButton d={ICON.plus} label="Add: ask, message or book" onPress={() => setAdding(true)} />} />
          <Text style={{ ...type.body, color: needs.length ? palette.muted : palette.green, fontWeight: needs.length ? "400" : "600" }}>{insight}</Text>
          {needs.length > 0 && <Animated.View layout={layout} exiting={FadeOut.duration(200)} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {needs.map(n => <Animated.View key={`${n.kind}:${n.label}`} layout={layout} entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)}>
              <Chip label={n.label} dot={n.dot} onPress={() => go(n.kind)} />
            </Animated.View>)}
          </Animated.View>}
        </View>
        {/* Asked once, after joining: never at launch, and only before the patient chooses. */}
        <NudgeCard />
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
      <View onLayout={spot("cards")} style={{ flexDirection: stack ? "column" : "row", gap: 8 }}>
        <View style={{ flex: stack ? undefined : 1, gap: 8 }}>
          <MedicinesTile index={0} still={calm} />
          <LatestTile index={2} still={calm} onCheckIn={() => jump("today")} />
        </View>
        <View style={{ flex: stack ? undefined : 1, gap: 8 }}>
          <ConsistencyTile index={1} still={calm} />
          <VisitTile index={3} still={calm} hospital={me?.hospital} />
        </View>
      </View>
      <Animated.View entering={rise(calm, 4)} onLayout={spot("today")} style={{ gap: 12 }}>
        <Section light="Today's" bold="check-in" />
        <TodayCard />
      </Animated.View>
      <Text style={{ ...type.footnote, color: palette.muted, textAlign: "center" }}>Not for emergencies · call 999</Text>
      <AddSheet open={adding} onClose={() => setAdding(false)} />
    </>}
    {state !== "loading" && <Pressable accessibilityRole="button" onPress={() => { void forgetPhone().finally(() => authClient.signOut()); }} style={{ alignSelf: "center", minHeight: 48, minWidth: 48, justifyContent: "center" }}>
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>Sign out</Text>
    </Pressable>}
  </KeyboardAwareScrollView>;
}
