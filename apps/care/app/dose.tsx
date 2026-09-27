import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import Animated, { cancelAnimation, Easing, FadeInDown, useAnimatedProps, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";
import { markTaken, useNextDose, useNow } from "@/features/doses";
import { clock, dosesToday, untilLine, weekOf, type DayDose } from "@/features/doses/model";
import { Pill, tintOf } from "@/features/doses/pill";
import { streak, streakLine } from "@/features/doses/streak";
import { checkState, doseLine, prescriptions, weekStrip, type Prescription } from "@/features/doses/strip";
import { Sunbeam } from "@/lib/halftone";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { Button, Card, CircleButton, ICON, pillStyle, surfaceStyle } from "@/lib/ui";

const home = () => router.canGoBack() ? router.back() : router.replace("/");
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const PLAN = "M9 3h6v4H9zM9 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-3M9 12h6M9 16h4"; // clipboard: the discharge plan
const CHECK = "M20 6 9 17l-5-5";
const ACircle = Animated.createAnimatedComponent(Circle);
const TONE = { amber: { bg: palette.amberWash, fg: palette.amber }, green: { bg: palette.mutedWash, fg: palette.green }, muted: { bg: palette.mutedWash, fg: palette.muted } } as const;

/**
 * Medicine (Life OS frame 6): the week around today with a dot per day so far, the streak and one
 * honest headline with today's count on a ring, then today's checklist, where a dose due within 2 h
 * (or late) is logged in place by holding its round check. Below, the medicines on a timer with what
 * is left of each course. The full plan is one tap away, top right.
 */
export default function DoseScreen() {
  const now = useNow();
  const { plan, taken = [], meds } = useNextDose(now);
  const [took, setTook] = useState<{ key: string; at: number }>();
  const out = plan?.status === "discharged" ? plan.dischargedAt : undefined;
  const today = dosesToday(meds, out, taken, now);
  const rx = prescriptions(meds, taken);
  const count = today.filter(d => d.taken).length;
  const holdable = today.some(d => checkState(d, now) === "now");
  const behind = today.some(d => !d.taken && d.dueAt.getTime() < now.getTime() - 30 * 60_000);
  const n = streak(meds, out, taken, now);
  const headline = behind ? "Let's take today's doses" : "You're doing great!";

  const take = (d: DayDose) => {
    markTaken(d.key); // ignores a key already logged, so a second hold can't double it
    setTook({ key: d.key, at: Date.now() });
  };

  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 20 }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <CircleButton d={ICON.back} label="Back" onPress={home} />
      <Text accessibilityRole="header" style={{ flexShrink: 1, fontSize: 18, lineHeight: 24, fontWeight: "500", color: palette.ink, textAlign: "center" }}>Medicine</Text>
      <CircleButton d={PLAN} label="Your discharge plan" onPress={() => router.push("/discharge")} />
    </View>

    {!plan ? <ActivityIndicator color={palette.muted} />
      : !out ? <Card>
        <Text style={{ ...type.headline, color: palette.ink }}>Once you go home</Text>
        <Text style={{ ...type.body, color: palette.muted }}>Your medicines show here once you're discharged.</Text>
      </Card>
      : !rx.length ? <Card>
        <Text style={{ ...type.headline, color: palette.ink }}>Nothing on a timer</Text>
        <Text style={{ ...type.body, color: palette.muted }}>Your medicines are taken when you need them. Your discharge plan says how.</Text>
        <Button quiet label="See my discharge plan" onPress={() => router.push("/discharge")} />
      </Card>
      : <>
        <Rise i={0}><Week days={weekStrip(weekOf(meds, out, taken, now), now)} /></Rise>

        <Rise i={1}>
          <View accessible accessibilityRole="header" accessibilityLabel={`${streakLine(n).replace(" 🔥", "")}. ${headline}${today.length ? ` ${count} of ${today.length} taken today.` : ""}`}
            style={{ alignItems: "center", gap: 10 }}>
            <Text style={{ ...type.body, fontWeight: "500", color: palette.muted }}>{streakLine(n)}</Text>
            <Text style={{ fontSize: 36, lineHeight: 42, letterSpacing: -1, fontWeight: "300", color: palette.ink, textAlign: "center" }}>{headline}</Text>
            {today.length > 0 && <View style={[pillStyle, { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 7, paddingRight: 14, paddingVertical: 6, backgroundColor: palette.white }]}>
              <Ring value={count / today.length} />
              <Text style={{ fontSize: 15, fontWeight: "600", color: palette.ink, fontVariant: ["tabular-nums"] }}>{count} of {today.length} taken</Text>
            </View>}
          </View>
        </Rise>

        <Rise i={2}>
          <View style={{ gap: 10 }}>
            <View style={{ gap: 2 }}>
              <Text accessibilityRole="header" style={{ fontSize: 20, lineHeight: 26, fontWeight: "500", color: palette.ink }}>Today's checklist</Text>
              {holdable && <Text style={{ ...type.footnote, color: palette.muted }}>Press and hold the circle once you've taken it.</Text>}
            </View>
            {today.length ? <View style={{ gap: 8 }}>
              {today.map(d => <DoseRow key={d.key} d={d} now={now} pop={d.key === took?.key} onTake={() => take(d)} />)}
              <Sunbeam play={took?.at} radius={22} />
            </View> : <Text style={{ ...type.body, color: palette.muted }}>Nothing due today.</Text>}
          </View>
        </Rise>

        <Rise i={3}>
          <View style={{ gap: 10 }}>
            <Text accessibilityRole="header" style={{ fontSize: 20, lineHeight: 26, fontWeight: "500", color: palette.ink }}>Active prescriptions</Text>
            <View style={[surfaceStyle, { paddingHorizontal: 14 }]}>
              {rx.map((p, i) => <RxRow key={p.name} p={p} first={i === 0} />)}
            </View>
          </View>
        </Rise>

        <Text style={{ ...type.footnote, color: palette.muted, textAlign: "center" }}>Missed one? Don't take two at once. Take the next one at its usual time.</Text>
      </>}
  </ScrollView>;
}

/** Sections rise in on the ease-out, 40 ms apart; still under Reduce Motion. */
function Rise({ i, children }: { i: number; children: ReactNode }) {
  const reduced = useReducedMotion();
  return <Animated.View entering={reduced ? undefined : FadeInDown.duration(320).delay(i * 40).easing(EASE_OUT)}>{children}</Animated.View>;
}

/** The 7-day strip: today in blue, a green or amber dot under each day so far. Read-only, read out as one line. */
function Week({ days }: { days: ReturnType<typeof weekStrip> }) {
  const said = days.filter(d => d.mark || d.today).map(d => `${d.today ? "Today" : `${d.weekday} ${d.date}`}${d.mark === "green" ? ", all taken" : d.mark === "amber" ? ", a dose missed" : ""}`).join("; ");
  return <View accessible accessibilityLabel={`This week. ${said}`} style={{ flexDirection: "row", gap: 6 }}>
    {days.map(d => <View key={d.key} style={[surfaceStyle, { flex: 1, borderRadius: 999, paddingVertical: 10, alignItems: "center", gap: 3 }, d.today && { backgroundColor: palette.blue }]}>
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 11, lineHeight: 14, fontWeight: "500", color: d.today ? "rgba(255,255,255,0.8)" : palette.faint }}>{d.weekday}</Text>
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 17, lineHeight: 22, fontWeight: "600", color: d.today ? palette.white : palette.ink, fontVariant: ["tabular-nums"] }}>{d.date}</Text>
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: d.mark === "green" ? palette.success : d.mark === "amber" ? palette.warning : "transparent" }} />
    </View>)}
  </View>;
}

const RING_R = 8, RING_C = 2 * Math.PI * RING_R;
/** Today's share taken as a small arc that eases to its value; set at once under Reduce Motion. */
function Ring({ value }: { value: number }) {
  const reduced = useReducedMotion();
  const p = useSharedValue(reduced ? value : 0);
  useEffect(() => { p.set(reduced ? value : withTiming(value, { duration: 600, easing: EASE_OUT })); }, [value, reduced, p]);
  const arc = useAnimatedProps(() => ({ strokeDashoffset: RING_C * (1 - p.get()) }));
  return <Svg width={22} height={22} viewBox="0 0 22 22">
    <Circle cx={11} cy={11} r={RING_R} stroke={palette.line} strokeWidth={3} fill="none" />
    <ACircle cx={11} cy={11} r={RING_R} stroke={palette.blue} strokeWidth={3} fill="none" strokeDasharray={RING_C} animatedProps={arc} transform="rotate(-90 11 11)" />
  </Svg>;
}

/** The medicine drawn small on its pale tint, as the row's icon tile. */
const Tile = ({ name }: { name: string }) => <View style={{ width: 44, height: 44, borderRadius: 14, borderCurve: "continuous", backgroundColor: tintOf(name), alignItems: "center", justifyContent: "center" }}>
  <Pill name={name} size={40} />
</View>;

/** One of today's doses: the medicine, how much and when, and its round check (taken, hold to log, later or missed). */
function DoseRow({ d, now, pop, onTake }: { d: DayDose; now: Date; pop: boolean; onTake: () => void }) {
  const state = checkState(d, now), line = doseLine(d.line, d.dueAt);
  const late = state === "now" && untilLine(d.dueAt, now).endsWith("late");
  const sub = state === "missed" ? `Missed · ${line}` : late ? `${line} · ${untilLine(d.dueAt, now)}` : line;
  const said = `${d.name} ${clock(d.dueAt)}, ${state === "taken" ? "taken" : state === "missed" ? "missed" : late ? `not taken, ${untilLine(d.dueAt, now)}` : "not taken"}`;
  return <View accessible={state !== "now"} accessibilityLabel={state !== "now" ? `${said}. ${line}` : undefined}
    style={[surfaceStyle, { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, minHeight: 68 }]}>
    <View accessibilityElementsHidden={state === "now"} importantForAccessibility={state === "now" ? "no-hide-descendants" : "auto"} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Tile name={d.name} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.headline, color: palette.ink }}>{d.name}</Text>
        <Text style={{ ...type.footnote, fontWeight: late || state === "missed" ? "600" : "400", color: late || state === "missed" ? palette.amber : palette.muted }}>{sub}</Text>
      </View>
    </View>
    {state === "taken" ? <Taken pop={pop} />
      : state === "now" ? <HoldCheck label={`${said}. Press and hold to mark as taken`} doneLabel={`${d.name} marked as taken`} onDone={onTake} />
      : <View style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: palette.line, alignItems: "center", justifyContent: "center" }}>
        {state === "later" && <Text maxFontSizeMultiplier={1.1} style={{ fontSize: 10, fontWeight: "600", color: palette.faint, fontVariant: ["tabular-nums"] }}>{clock(d.dueAt).replace(":00", "")}</Text>}
      </View>}
  </View>;
}

/** The check springs in from 0.6 with a slight overshoot (the confirm spring), never from nothing. */
const checkIn = () => {
  "worklet";
  return { initialValues: { opacity: 0, transform: [{ scale: 0.6 }] }, animations: { opacity: withTiming(1, { duration: 160 }), transform: [{ scale: withSpring(1, { duration: 380, dampingRatio: 0.72 }) }] } };
};

/** A taken dose: a blue disc with a white check; `pop` springs it in (the one just logged), still under Reduce Motion. */
function Taken({ pop }: { pop: boolean }) {
  const reduced = useReducedMotion();
  return <Animated.View entering={pop && !reduced ? checkIn : undefined} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: palette.blue, alignItems: "center", justifyContent: "center" }}>
    <Svg width={20} height={20} viewBox="0 0 24 24"><Path d={CHECK} fill="none" stroke={palette.white} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" /></Svg>
  </Animated.View>;
}

const HOLD = 600, HOLD_R = 19, HOLD_C = 2 * Math.PI * HOLD_R;
/**
 * The round check as a compact hold (after HoldButton): pressing fills the ring blue over 0.6 s and
 * letting go early drains it, so a stray tap can't log a dose. VoiceOver's activate confirms at once.
 * The finish buzzes, is announced, and the row swaps to the blue check.
 */
function HoldCheck({ label, doneLabel, onDone }: { label: string; doneLabel: string; onDone: () => void }) {
  const p = useSharedValue(0);
  const finish = () => {
    if (process.env.EXPO_OS === "ios") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    AccessibilityInfo.announceForAccessibility(doneLabel);
    onDone();
  };
  const start = () => {
    if (process.env.EXPO_OS === "ios") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    p.set(withTiming(1, { duration: HOLD * (1 - p.get()), easing: Easing.linear }, ok => { if (ok) scheduleOnRN(finish); }));
  };
  const stop = () => {
    if (p.get() >= 1) return;
    cancelAnimation(p);
    p.set(withTiming(0, { duration: 250 }));
  };
  const arc = useAnimatedProps(() => ({ strokeDashoffset: HOLD_C * (1 - p.get()) }));
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPressIn={start} onPressOut={stop} onAccessibilityTap={finish} style={{ width: 44, height: 44 }}>
    <Svg width={44} height={44} viewBox="0 0 44 44">
      <Circle cx={22} cy={22} r={HOLD_R} stroke={palette.blue} strokeOpacity={0.28} strokeWidth={3} fill="none" />
      <ACircle cx={22} cy={22} r={HOLD_R} stroke={palette.blue} strokeWidth={3} fill="none" strokeLinecap="round" strokeDasharray={HOLD_C} animatedProps={arc} transform="rotate(-90 22 22)" />
    </Svg>
  </Pressable>;
}

/** A medicine on a timer: its tile, the plan's plain line, what is left of the course; opens the medicine's sheet. */
function RxRow({ p, first }: { p: Prescription; first: boolean }) {
  const tone = TONE[p.tone];
  return <Pressable accessibilityRole="button" accessibilityLabel={`${p.name}. ${p.line}. ${p.badge}`} onPress={() => router.push({ pathname: "/medicine", params: { name: p.name } })}
    style={({ pressed }) => ({ minHeight: 68, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderTopWidth: first ? 0 : 1, borderColor: palette.line, opacity: pressed ? 0.6 : 1 })}>
    <Tile name={p.name} />
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ ...type.headline, color: palette.ink }}>{p.name}</Text>
      <Text style={{ ...type.footnote, color: palette.muted }}>{p.line}</Text>
    </View>
    <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: tone.bg }}>
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12.5, fontWeight: "600", color: tone.fg, fontVariant: ["tabular-nums"] }}>{p.badge}</Text>
    </View>
  </Pressable>;
}
