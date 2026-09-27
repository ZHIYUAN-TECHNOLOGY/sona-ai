import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View, type LayoutChangeEvent } from "react-native";
import { AnimatedText, Text } from "@/lib/text";
import Animated, { FadeIn, FadeOut, LinearTransition, useReducedMotion, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { todayOf } from "@/features/check-ins/model";
import { TodayCard, useCheckIns } from "@/features/check-ins/today";
import { DoseCard, IconTile, rise, Tile, useNextDose, useNow } from "@/features/doses";
import { clock, dosesToday, dueNow } from "@/features/doses/model";
import { away } from "@/features/follow-ups/lines";
import { useFollowUps, VisitCard } from "@/features/follow-ups/row";
import { checkInToday, daysHome, GLASSES, headline, needsLine, recovery, type Need, type Part } from "@/features/home";
import { useMe } from "@/features/me";
import { useMessageNeeds } from "@/features/messages/row";
import { Welcome } from "@/features/sign-in/welcome";
import { setGlasses, tapCup, useWater } from "@/features/water";
import { authClient } from "@/lib/auth-client";
import { DOCK_SPACE } from "@/lib/dock";
import { palette, type } from "@/lib/theme";
import { Button, Card, Chip, CircleButton, ICON, Section, surfaceStyle, Title } from "@/lib/ui";
import { orpc } from "@/utils/orpc";

/** Every open thing on home, most urgent first as the headline reads them; each chip jumps to or opens its thing. */
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

/** The confirm spring on something just added (a filled cup, the bell's count): from 0.6, never from nothing. */
const pop = () => {
  "worklet";
  return { initialValues: { opacity: 0, transform: [{ scale: 0.6 }] }, animations: { opacity: withTiming(1, { duration: 160 }), transform: [{ scale: withSpring(1, { duration: 380, dampingRatio: 0.72 }) }] } };
};

const CUP = "M5 3h14l-1.7 17.2A2 2 0 0 1 15.3 22H8.7a2 2 0 0 1-2-1.8Z";
const DROP = "M12 2.7c3.7 4.3 6.5 7.8 6.5 11.3a6.5 6.5 0 0 1-13 0c0-3.5 2.8-7 6.5-11.3Z";

/**
 * Water (Life OS): a blue drop tile, today's count, and 8 cups. Tap the next cup (ringed blue with a +)
 * to add a glass, a later one to log several, the last filled one to take one back. Patient-entered,
 * kept on the phone per day. Each cup is its own button; the new cup fills on the confirm spring.
 */
function WaterCard({ index, glasses, onLayout }: { index: number; glasses: number; onLayout: (e: LayoutChangeEvent) => void }) {
  const reduced = useReducedMotion();
  const [last, setLast] = useState<number>();
  const tap = (i: number) => {
    const n = tapCup(glasses, i);
    setLast(n > glasses ? n - 1 : undefined);
    setGlasses(n);
    if (process.env.EXPO_OS === "ios") void Haptics.selectionAsync();
    AccessibilityInfo.announceForAccessibility(`${n} of ${GLASSES} glasses`);
  };
  const says = (i: number) => i === glasses ? `Add a glass, ${glasses} of ${GLASSES}` : i > glasses ? `Log ${i + 1} of ${GLASSES} glasses` : i === glasses - 1 ? `Take back a glass, ${glasses} of ${GLASSES}` : `Set to ${i + 1} of ${GLASSES} glasses`;
  return <Animated.View entering={rise(reduced, index)} onLayout={onLayout} style={[surfaceStyle, { padding: 16, paddingBottom: 8, gap: 6 }]}>
    <View accessible accessibilityLabel={`Water. ${glasses} of ${GLASSES} glasses today`} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <IconTile bg={palette.blueWash}><Svg width={18} height={18} viewBox="0 0 24 24"><Path d={DROP} fill={palette.blue} /></Svg></IconTile>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 17, lineHeight: 22, fontWeight: "500", color: palette.ink }}>Water</Text>
        <Text style={{ fontSize: 13, lineHeight: 18, color: palette.muted, fontVariant: ["tabular-nums"] }}>{glasses} of {GLASSES} glasses</Text>
      </View>
    </View>
    <View style={{ flexDirection: "row", marginHorizontal: -6 }}>
      {Array.from({ length: GLASSES }, (_, i) => <Pressable key={i} accessibilityRole="button" accessibilityLabel={says(i)} onPress={() => tap(i)}
        style={({ pressed }) => ({ flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", transform: [{ scale: pressed ? 0.96 : 1 }] })}>
        {i < glasses
          ? <Animated.View entering={!reduced && i === last ? pop : undefined}><Svg width={22} height={26} viewBox="0 0 24 24"><Path d={CUP} fill={palette.blue} stroke={palette.blue} strokeWidth={1.6} strokeLinejoin="round" /></Svg></Animated.View>
          : <Svg width={22} height={26} viewBox="0 0 24 24">
            <Path d={CUP} fill={i === glasses ? palette.blueWash : "none"} stroke={i === glasses ? palette.blue : palette.faint} strokeWidth={1.6} strokeLinejoin="round" />
            {i === glasses && <Path d="M12 9.5v6M9 12.5h6" stroke={palette.blue} strokeWidth={1.8} strokeLinecap="round" />}
          </Svg>}
      </Pressable>)}
    </View>
  </Animated.View>;
}

// Recovery parts by colour (Life OS "Analytics Today"): the violet matches the dose sparkline, the blue the water card.
const TONE: Record<Part["key"], string> = { medicines: palette.feature, "check-in": palette.success, water: palette.info, visits: palette.away };
const NEXT: Record<Part["key"], string> = { medicines: "See today's medicines", "check-in": "Answer today's check-in", water: "Add a glass of water", visits: "See your visit" };

/**
 * "Recovery today" (Life OS "Analytics Today"): the day's %, a segmented bar (each part's share of its
 * quarter, grey for what's left) and a 2×2 legend with each part's % and plain note, all from real
 * data (doses, check-in, water logged, visits). The bar's parts spring to new widths. Tap goes to the
 * part furthest behind, named in blue as the next step.
 */
function RecoveryCard({ index, glasses, onGo }: { index: number; glasses: number; onGo: (key: Part["key"]) => void }) {
  const now = useNow();
  const reduced = useReducedMotion();
  const { plan, taken, meds } = useNextDose(now);
  const checkIns = useCheckIns().data;
  const visit = useFollowUps().data?.[0];
  const r = recovery({ doses: plan?.status === "discharged" ? dosesToday(meds, plan.dischargedAt, taken, now) : [], checkIn: checkIns && checkInToday(checkIns, now), glasses, visit: visit && { inDays: visit.inDays, overdue: visit.status === "overdue" } });
  const counted = r.parts.filter(p => p.share !== undefined);
  const rest = counted.length - counted.reduce((s, p) => s + p.share!, 0);
  const layout = reduced ? undefined : LinearTransition.springify().duration(380).dampingRatio(1);
  const pct = (p: Part) => p.share === undefined ? "—" : `${Math.round(p.share * 100)}%`;
  return <Tile index={index} label={`Recovery today, ${r.pct}%. ${r.parts.map(p => `${p.label}: ${p.note}`).join(". ")}.${r.next ? ` Next: ${NEXT[r.next]}` : ""}`} onPress={() => onGo(r.next ?? "medicines")}>
    <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
      <Text style={{ flexShrink: 1, fontSize: 17, lineHeight: 22, fontWeight: "500", color: palette.ink }}>Recovery today</Text>
      <Text style={{ fontSize: 28, lineHeight: 32, fontWeight: "400", letterSpacing: -0.8, color: palette.ink, fontVariant: ["tabular-nums"] }}>{r.pct}<Text style={{ fontSize: 15, color: palette.muted }}>%</Text></Text>
    </View>
    <View style={{ flexDirection: "row", height: 12, gap: 3 }}>
      {counted.filter(p => p.share! > 0).map(p => <Animated.View key={p.key} layout={layout} style={{ flex: p.share, borderRadius: 6, backgroundColor: TONE[p.key] }} />)}
      {rest > 0 && <Animated.View key="rest" layout={layout} style={{ flex: rest, borderRadius: 6, backgroundColor: palette.mutedWash }} />}
    </View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 12 }}>
      {r.parts.map(p => <View key={p.key} style={{ width: "50%", flexDirection: "row", gap: 8, paddingRight: 8 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: p.share === undefined ? palette.line : TONE[p.key] }} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, lineHeight: 19, color: palette.muted }}>{p.label}  <Text style={{ fontWeight: "600", color: palette.ink, fontVariant: ["tabular-nums"] }}>{pct(p)}</Text></Text>
          <Text numberOfLines={2} style={{ fontSize: 12, lineHeight: 16, color: palette.faint }}>{p.note}</Text>
        </View>
      </View>)}
    </View>
    {r.next && <Text style={{ fontSize: 13, lineHeight: 18, fontWeight: "600", color: palette.blue }}>{NEXT[r.next]} ›</Text>}
  </Tile>;
}

/**
 * Sona Care's home (Life OS frame 1), answering in order: who (initials) and does anything need me
 * (the bell's blue count), then over the blue hero "Hi Amelia 👋" and the big status headline (the
 * most urgent thing in words, else "Positive today") with a chip per open thing; then water to log in
 * place, Recovery today, the next dose (hold to log it) and next visit side by side, and the one
 * feature card, today's check-in. At large Dynamic Type the two small cards stack.
 */
export default function Home() {
  const { state, me } = useMe();
  const needs = useNeeds();
  const now = useNow();
  const glasses = useWater(now);
  const reply = useMessageNeeds() > 0;
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const scroll = useRef<ScrollView>(null);
  const spots = useRef({ water: 0, cards: 0, today: 0 });
  const health = useQuery(orpc.healthCheck.queryOptions());
  const offline = health.isError || (health.data !== undefined && health.data !== "OK");
  if (state === "signed-out") return <Welcome />;
  const layout = reduced ? undefined : LinearTransition.springify().duration(380).dampingRatio(1);
  const spot = (to: keyof typeof spots.current) => (e: LayoutChangeEvent) => { spots.current[to] = e.nativeEvent.layout.y; };
  const jump = (to: keyof typeof spots.current) => scroll.current?.scrollTo({ y: Math.max(0, spots.current[to] - insets.top - 12), animated: !reduced });
  const go = (kind: Need["kind"]) => kind === "dose" ? jump("cards") : kind === "check-in" ? jump("today") : router.push(kind === "reply" ? "/messages" : "/follow-ups");
  const bell = () => reply || !needs[0] ? router.push("/messages") : go(needs[0].kind);
  const onGo = (key: Part["key"]) => key === "medicines" ? router.push("/dose") : key === "visits" ? router.push("/follow-ups") : jump(key === "water" ? "water" : "today");
  const title = headline(needs);
  const day = daysHome(me?.dischargedAt, now);
  const sub = [day !== undefined && `Day ${day} at home`, !needs.length && "nothing needs you"].filter(Boolean).join(" · ").replace(/^n/, "N");
  const stack = fontScale >= 1.35;
  return <ScrollView ref={scroll} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: DOCK_SPACE, gap: 16 }}>
    {state === "joined" && me
      ? <>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View accessible accessibilityRole="image" accessibilityLabel={me.name} style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: palette.white, boxShadow: "0 6px 16px -10px rgba(40,50,110,0.35)" }}>
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 15, fontWeight: "600", color: palette.blue }}>{me.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}</Text>
          </View>
          <View>
            <CircleButton d={ICON.bell} label={`Notifications. ${needsLine(needs)}`} onPress={bell} />
            {needs.length > 0 && <Animated.View key={needs.length} entering={reduced ? undefined : pop} pointerEvents="none"
              style={{ position: "absolute", top: -4, right: -4, minWidth: 20, minHeight: 20, paddingHorizontal: 5, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: palette.blue, borderWidth: 2, borderColor: palette.white }}>
              <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 11, lineHeight: 14, fontWeight: "700", color: palette.white, fontVariant: ["tabular-nums"] }}>{needs.length}</Text>
            </Animated.View>}
          </View>
        </View>
        <View style={{ minHeight: 200, justifyContent: "flex-end", gap: 14 }}>
          <View accessible accessibilityRole="header" accessibilityLabel={`Hi ${me.firstName}. ${title}.${sub ? ` ${sub}.` : ""}`}>
            <Text style={{ fontSize: 18, lineHeight: 24, fontWeight: "300", color: palette.muted }}>Hi {me.firstName} 👋</Text>
            <AnimatedText key={title} entering={reduced ? undefined : FadeIn.duration(240)} style={{ fontSize: 40, lineHeight: 46, fontWeight: "400", letterSpacing: -1.4, color: palette.ink }}>{title}</AnimatedText>
            {sub ? <Text style={{ ...type.footnote, color: needs.length ? palette.muted : palette.green, fontWeight: needs.length ? "400" : "600", marginTop: 4 }}>{sub}</Text> : null}
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
      <WaterCard index={0} glasses={glasses} onLayout={spot("water")} />
      <RecoveryCard index={1} glasses={glasses} onGo={onGo} />
      <View onLayout={spot("cards")} style={{ flexDirection: stack ? "column" : "row", gap: 12 }}>
        <View style={stack ? undefined : { flex: 1 }}><DoseCard index={2} /></View>
        <View style={stack ? undefined : { flex: 1 }}><VisitCard index={3} /></View>
      </View>
      <Animated.View entering={rise(reduced, 4)} onLayout={spot("today")} style={{ gap: 12 }}>
        <Section light="Today's" bold="check-in" />
        <TodayCard />
      </Animated.View>
      <Text style={{ ...type.footnote, color: palette.muted, textAlign: "center" }}>Not for emergencies · call 999</Text>
    </>}
    {state !== "loading" && <Pressable accessibilityRole="button" onPress={() => { void authClient.signOut(); }} style={{ alignSelf: "center", minHeight: 44, minWidth: 44, justifyContent: "center" }}>
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>Sign out</Text>
    </Pressable>}
  </ScrollView>;
}
