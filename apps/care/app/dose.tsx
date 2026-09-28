import { router } from "expo-router";
import { useEffect, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Modal, Pressable, ScrollView, useWindowDimensions, View, type ViewStyle } from "react-native";
import Animated, { FadeInDown, SlideInDown, useReducedMotion, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { scheduleLine } from "@/features/discharge/lines";
import { markTaken, Pill, rise, snooze, useNextDose, useNow, useSnooze } from "@/features/doses";
import { clock, dosesToday, early, isLate, untilLine, weekOf, whenWords, type DayDose, type Dose, type ScheduledMed } from "@/features/doses/model";
import { foodOf, insight, weekStrip } from "@/features/doses/strip";
import "@/features/doses/strings";
import { useMe } from "@/features/me";
import "@/features/messages/strings";
import { DOCK_SPACE } from "@/lib/dock";
import { Sunbeam } from "@/lib/halftone";
import { tFor, useLang } from "@/lib/i18n";
import { Text } from "@/lib/text";
import { motion, palette, space, type } from "@/lib/theme";
import { Button, Card, CircleButton, HoldButton, ICON, pillStyle, Section, surfaceStyle, Title } from "@/lib/ui";
import { now as clockNow } from "@/lib/clock";

const CHECK = "M20 6 9 17l-5-5";
const SNOOZE = 15 * 60_000, EARLY = 2 * 3600_000;
const open = (name: string) => router.push({ pathname: "/medicine", params: { name } });
// The tab rises in once per launch, not every time the patient comes back to it.
let shown = false;

/**
 * Medicine (the AI Health Companion kit's "Today's Medicines" and "Time to take Medicines"): one
 * insight line on today and the week as dots, then the one feature card for the next dose: time,
 * the medicine drawn big, how to take it, and a hold to mark it taken, or "Remind me later", which
 * steps the card aside for 15 min in this app. When nothing is due the same card says what is next.
 * Below, the care team one tap away and every medicine to take as a big pill card opening its sheet.
 */
export default function DoseScreen() {
  const now = useNow();
  const lang = useLang(), t = tFor(lang);
  const { plan, dose, taken = [], meds } = useNextDose(now);
  const reduced = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const [first] = useState(() => !shown);
  useEffect(() => { shown = true; }, []);
  const enter = (i: number) => first ? rise(reduced, i) : undefined;
  const [took, setTook] = useState<{ dose: Dose; at: Date }>();
  const out = plan?.status === "discharged" ? plan.dischargedAt : undefined;
  const today = dosesToday(meds, out, taken, now);
  const line = out ? insight(today, now, lang) : undefined;

  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.edge, paddingTop: space.top, paddingBottom: DOCK_SPACE, gap: space.stack }}>
    <Animated.View entering={enter(0)} style={{ gap: 14 }}>
      <Title greeting={t("dose.titleLight")} accent={t("dose.titleBold")} line={line?.text} lineTone={line?.tone} />
      {out && meds.some(m => m.at?.length) && <Week days={weekStrip(weekOf(meds, out, taken, now), now, lang)} />}
    </Animated.View>

    {!plan ? <ActivityIndicator color={palette.muted} />
      : !out ? <Card>
        <Text style={{ ...type.headline, color: palette.ink }}>{t("dose.notHomeTitle")}</Text>
        <Text style={{ ...type.body, color: palette.muted }}>{t("dose.notHomeLine")}</Text>
      </Card>
      : <>
        <Animated.View entering={enter(1)}>
          <NextCard dose={dose} now={now} took={took} onTook={d => setTook({ dose: d, at: clockNow() })} />
        </Animated.View>

        <Animated.View entering={enter(2)} style={{ gap: 12 }}>
          <Section light={t("dose.yourLight")} bold={t("dose.yourBold")} action={<FullPlan />} />
          <CareTeam />
        </Animated.View>

        {/* Two columns; at large Dynamic Type, one card per row so names never squeeze. */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 }}>
          {meds.map((m, i) => <Animated.View key={m.name} entering={enter(3 + i)} style={{ width: fontScale > 1.3 ? "100%" : "48.2%" }}>
            <MedCard med={m} today={today.filter(d => d.name === m.name)} pop={took?.dose.name === m.name} />
          </Animated.View>)}
        </View>
        {!meds.length && <Text style={{ ...type.body, color: palette.muted }}>{t("dose.nothingAtHome")}</Text>}

        <Text style={{ ...type.footnote, color: palette.muted, textAlign: "center" }}>{t("dose.missedTip")}</Text>
      </>}
  </ScrollView>;
}

/** The week as seven small dots under the insight: green all taken, amber one missed, today ringed in blue. Read out as one line. */
function Week({ days }: { days: ReturnType<typeof weekStrip> }) {
  const t = tFor(useLang());
  const said = days.filter(d => d.mark || d.today).map(d => `${d.today ? t("dose.weekToday") : `${d.weekday} ${d.date}`}${d.mark === "green" ? t("dose.weekAll") : d.mark === "amber" ? t("dose.weekMissed") : ""}`).join("; ");
  return <View accessible accessibilityLabel={t("dose.week", { days: said })} style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 4 }}>
    {days.map(d => <View key={d.key} style={{ alignItems: "center", gap: 6, minWidth: 32 }}>
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, lineHeight: 16, fontWeight: d.today ? "700" : "500", color: d.today ? palette.blue : palette.faint }}>{d.weekday.slice(0, 2)}</Text>
      <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: d.mark === "green" ? palette.success : d.mark === "amber" ? palette.warning : palette.line,
        borderWidth: d.today ? 2 : 0, borderColor: palette.blue }} />
    </View>)}
  </View>;
}

/** A white capsule for a value (the dose time), amber when the dose is late. */
function Capsule({ children, tone }: { children: string; tone?: "amber" }) {
  return <View style={[pillStyle, { alignSelf: "center", paddingHorizontal: 14, paddingVertical: 6 }, tone && { backgroundColor: palette.amberWash, borderColor: palette.amberEdge }]}>
    <Text style={{ fontSize: 15, lineHeight: 20, fontWeight: "600", color: tone ? palette.amber : palette.ink, fontVariant: ["tabular-nums"], textAlign: "center" }}>{children}</Text>
  </View>;
}

const nameStyle = { fontSize: 24, lineHeight: 30, fontWeight: "600", letterSpacing: -0.8, color: palette.ink, textAlign: "center" } as const;
const centred = { ...type.body, color: palette.muted, textAlign: "center" } as const;

/**
 * The one feature card. Due (from 2 h before until 6 h late, as everywhere): "Time to take" with the
 * hold and "Remind me later". Snoozed: when it comes back. Just taken: a popped check and what is next.
 * Early: what is next and from when it can be marked. Nothing on a timer: says so.
 */
function NextCard({ dose, now, took, onTook }: { dose?: Dose; now: Date; took?: { dose: Dose; at: Date }; onTook: (d: Dose) => void }) {
  const lang = useLang(), t = tFor(lang);
  const snoozed = useSnooze();
  const [asking, setAsking] = useState(false);
  const due = dose && !early(dose.dueAt, now) ? dose : undefined;
  const resting = due && snoozed?.key === due.key && snoozed.until > now.getTime() ? snoozed : undefined;
  // Just logged: the done state holds until the next dose is itself due.
  const logged = took && !due ? took : undefined;

  if (due && !resting) {
    const late = isLate(due.dueAt, now) ? untilLine(due.dueAt, now, lang) : undefined;
    const food = foodOf(due.line);
    return <Card feature style={{ alignItems: "center", gap: 12 }}>
      <View accessible accessibilityLabel={t("dose.timeToTakeA11y", { name: due.name, time: clock(due.dueAt, lang), late: late ? `, ${late}` : "", line: due.line })} style={{ alignItems: "center", gap: 10, alignSelf: "stretch" }}>
        <Text style={{ ...type.footnote, fontWeight: "500", color: palette.faint }}>{t("dose.timeToTake")}</Text>
        <Capsule tone={late ? "amber" : undefined}>{late ? `${clock(due.dueAt, lang)} · ${late}` : clock(due.dueAt, lang)}</Capsule>
        <Pill name={due.name} size={132} />
        <Text style={nameStyle}>{due.name}</Text>
        <Text style={centred}>{sentenceCase(due.line)}</Text>
        {food && <Food when={food} />}
      </View>
      <View style={{ alignSelf: "stretch", marginTop: 4 }}>
        <HoldButton key={due.key} label={t("dose.hold")} doneLabel={t("dose.taken", { name: due.name })} onDone={() => { markTaken(due.key); onTook(due); }} />
      </View>
      <Pressable accessibilityRole="button" accessibilityHint={t("dose.laterHint")} onPress={() => setAsking(true)}
        style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: 16, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
        <Text style={{ fontSize: 16, fontWeight: "500", color: palette.muted }}>{t("dose.later")}</Text>
      </Pressable>
      <RemindSheet visible={asking} name={due.name} onClose={() => setAsking(false)} onRemind={() => {
        const until = clockNow().getTime() + SNOOZE;
        snooze({ key: due.key, until });
        setAsking(false);
        AccessibilityInfo.announceForAccessibility(t("dose.showAgainAt", { name: due.name, time: clock(new Date(until), lang) }));
      }} />
    </Card>;
  }

  if (resting && due) return <Card style={{ alignItems: "center", gap: 10 }}>
    <View accessible style={{ alignItems: "center", gap: 8 }}>
      <Capsule>{t("dose.backAt", { time: clock(new Date(resting.until), lang) })}</Capsule>
      <Pill name={due.name} size={84} />
      <Text style={nameStyle}>{due.name}</Text>
      <Text style={centred}>{t("dose.againAt", { time: clock(new Date(resting.until), lang) })}</Text>
    </View>
    <View style={{ alignSelf: "stretch" }}><Button quiet label={t("dose.showNow")} onPress={() => snooze(undefined)} /></View>
  </Card>;

  const next = dose ? t("dose.next", { name: dose.name, when: whenWords(dose.dueAt, now, lang) }) : t("dose.nothingElse");
  if (logged) return <Card style={{ alignItems: "center", gap: 10 }}>
    <View accessible accessibilityLabel={t("dose.takenAtA11y", { name: logged.dose.name, time: clock(logged.at, lang), next })} style={{ alignItems: "center", gap: 8 }}>
      <Check size={56} pop />
      <Text style={nameStyle}>{t("dose.taken", { name: logged.dose.name })}</Text>
      <Text style={centred}>{t("dose.loggedAt", { time: clock(logged.at, lang) })}</Text>
      <View style={{ alignSelf: "stretch", height: 1, backgroundColor: palette.line, marginVertical: 4 }} />
      <Text style={{ ...type.body, color: palette.ink, textAlign: "center" }}>{next}</Text>
    </View>
    <Sunbeam play={logged.at.getTime()} radius={32} />
  </Card>;

  if (dose) return <Card style={{ alignItems: "center", gap: 10 }}>
    <View accessible style={{ alignItems: "center", gap: 8 }}>
      <Text style={{ ...type.footnote, fontWeight: "500", color: palette.faint }}>{t("dose.nextUp")}</Text>
      <Capsule>{whenWords(dose.dueAt, now, lang)}</Capsule>
      <Pill name={dose.name} size={96} />
      <Text style={nameStyle}>{dose.name}</Text>
      <Text style={centred}>{sentenceCase(dose.line)}</Text>
      <Text style={{ ...type.footnote, color: palette.faint, textAlign: "center" }}>{t("dose.markFrom", { time: clock(new Date(dose.dueAt.getTime() - EARLY), lang) })}</Text>
    </View>
  </Card>;

  return <Card>
    <Text style={{ ...type.headline, color: palette.ink }}>{t("dose.noTimer")}</Text>
    <Text style={{ ...type.body, color: palette.muted }}>{t("dose.noTimerLine")}</Text>
  </Card>;
}

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The kit's Before / After food segmented pill, showing what the plan says (read-only). */
function Food({ when }: { when: "before" | "after" }) {
  const t = tFor(useLang());
  return <View accessible accessibilityLabel={t(`dose.foodA11y.${when}`)} style={[pillStyle, { flexDirection: "row", padding: 3, alignSelf: "center" }]}>
    {(["before", "after"] as const).map(w => <View key={w} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: w === when ? palette.dark : "transparent" }}>
      <Text style={{ fontSize: 14, fontWeight: "600", color: w === when ? palette.white : palette.faint }}>{t(`dose.food.${w}`)}</Text>
    </View>)}
  </View>;
}

/**
 * The kit's "Remind me later?" sheet: white, 40 pt corners, springing up with its rows 40 ms apart
 * (after Canopi's sheet); an orange ! badge, one honest line, black "Remind in 15 min", Cancel.
 */
function RemindSheet({ visible, name, onRemind, onClose }: { visible: boolean; name: string; onRemind: () => void; onClose: () => void }) {
  const t = tFor(useLang());
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const row = (i: number) => reduced ? undefined : FadeInDown.springify().duration(motion.spring.duration).dampingRatio(1).delay(80 + i * motion.stagger);
  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <Pressable accessibilityRole="button" accessibilityLabel={t("common.cancel")} onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(31,31,31,0.28)" }} />
    <Animated.View accessibilityViewIsModal entering={reduced ? undefined : SlideInDown.springify().duration(420).dampingRatio(0.86)}
      style={{ position: "absolute", left: 10, right: 10, bottom: Math.max(insets.bottom, 10), borderRadius: 40, borderCurve: "continuous", backgroundColor: palette.white, padding: 24, paddingTop: 28, gap: 12, alignItems: "center" } as ViewStyle}>
      <Animated.View entering={row(0)} style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: palette.amberWash, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: palette.warning, transform: [{ rotate: "45deg" }] }} />
        <Text style={{ position: "absolute", fontSize: 20, lineHeight: 24, fontWeight: "700", color: palette.white }}>!</Text>
      </Animated.View>
      <Animated.View entering={row(1)} accessible accessibilityRole="header">
        <Text style={{ ...nameStyle }}>{t("dose.remindTitle")}</Text>
      </Animated.View>
      <Animated.View entering={row(2)}>
        <Text style={centred}>{t("dose.remindLine", { name })}</Text>
      </Animated.View>
      <Animated.View entering={row(3)} style={{ alignSelf: "stretch", marginTop: 6 }}>
        <Button label={t("dose.remind")} onPress={onRemind} />
      </Animated.View>
      <Animated.View entering={row(4)}>
        <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: 24, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ fontSize: 16, fontWeight: "600", color: palette.ink }}>{t("common.cancel")}</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  </Modal>;
}

/** The check springs in from 0.6 with a slight overshoot (the confirm spring), never from nothing. */
const checkIn = () => {
  "worklet";
  return { initialValues: { opacity: 0, transform: [{ scale: 0.6 }] }, animations: { opacity: withTiming(1, { duration: 160 }), transform: [{ scale: withSpring(1, motion.pop) }] } };
};

/** A green disc with a white check; `pop` springs it in (the dose just logged), still under Reduce Motion. */
function Check({ size, pop, style }: { size: number; pop?: boolean; style?: ViewStyle }) {
  const reduced = useReducedMotion();
  return <Animated.View entering={pop && !reduced ? checkIn : undefined} style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: palette.success, alignItems: "center", justifyContent: "center" }, style]}>
    <Svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24"><Path d={CHECK} fill="none" stroke={palette.white} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" /></Svg>
  </Animated.View>;
}

/** "Full plan": the whole discharge plan (leaflet, warning signs, what's next), as a white capsule. */
function FullPlan() {
  const t = tFor(useLang());
  return <Pressable accessibilityRole="button" accessibilityLabel={t("dose.fullPlan")} accessibilityHint={t("dose.fullPlanHint")} onPress={() => router.push("/discharge")}
    style={({ pressed }) => [pillStyle, { minHeight: 48, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 6, transform: [{ scale: pressed ? motion.press : 1 }] }]}>
    <Text style={{ fontSize: 15, fontWeight: "600", color: palette.ink }}>{t("dose.fullPlan")}</Text>
    <Text style={{ fontSize: 18, color: palette.muted }}>›</Text>
  </Pressable>;
}

/** The kit's contact row: the care team's initials, where they are and how soon they reply, and a round button to message them. */
function CareTeam() {
  const t = tFor(useLang());
  const { me } = useMe();
  return <View style={[surfaceStyle, { flexDirection: "row", alignItems: "center", gap: 12, padding: 10, paddingLeft: 12 }]}>
    <View style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: palette.blueWash }}>
      <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 16, fontWeight: "700", color: palette.blue }}>{t("dose.careTeamInitials")}</Text>
    </View>
    <View accessible style={{ flex: 1, gap: 1 }}>
      <Text style={{ ...type.headline, color: palette.ink }}>{t("dose.careTeam")}</Text>
      <Text numberOfLines={2} style={{ ...type.footnote, color: palette.faint }}>{[me?.hospital, t("msg.replyTimeShort")].filter(Boolean).join(" · ")}</Text>
    </View>
    <CircleButton d={ICON.chat} label={t("dose.messageTeam")} onPress={() => router.push("/messages")} />
  </View>;
}

/** One medicine in the grid (the kit's big pill card): the medicine drawn big, its name and schedule; a green check once today's doses of it are taken. */
function MedCard({ med, today, pop }: { med: ScheduledMed; today: DayDose[]; pop: boolean }) {
  const lang = useLang(), t = tFor(lang);
  const done = today.length > 0 && today.every(d => d.taken), schedule = scheduleLine(med, lang);
  return <Pressable accessibilityRole="button" accessibilityLabel={[med.name, schedule, done && t("dose.todayTaken")].filter(Boolean).join(". ")} accessibilityHint={t("dose.openHint")} onPress={() => open(med.name)}
    style={({ pressed }) => [surfaceStyle, { flexGrow: 1, minHeight: 196, padding: 16, paddingTop: 20, alignItems: "center", gap: 6, transform: [{ scale: pressed ? motion.press : 1 }] }]}>
    <Pill name={med.name} size={88} />
    <Text style={{ fontSize: 18, lineHeight: 23, fontWeight: "500", letterSpacing: -0.4, color: palette.ink, textAlign: "center" }}>{med.name}</Text>
    <Text style={{ ...type.footnote, color: palette.faint, textAlign: "center" }}>{schedule}</Text>
    {done && <Check size={28} pop={pop} style={{ position: "absolute", top: 12, right: 12 }} />}
  </Pressable>;
}
