import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Modal, Pressable, ScrollView, View, type ViewStyle } from "react-native";
import Animated, { FadeInDown, SlideInDown, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withSpring, withTiming, ZoomOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { scheduleLine, type Med } from "@/features/discharge/lines";
import { useDischarge } from "@/features/discharge/row";
import { EASE_OUT, markTaken, Pill, rise, snooze, tintOf, useNextDose, useNow, useSnooze } from "@/features/doses";
import { askOnce, RemindCard, RemindersKey, useReminders } from "@/features/doses/remind";
import { dayLabel } from "@/features/follow-ups/lines";
import { useMessageNeeds } from "@/features/messages/row";
import { clock, doseOf, dosesToday, dueNow, early, isLate, untilLine, weekOf, whenWords, type DayDose, type Dose } from "@/features/doses/model";
import { foodOf, insight, weekStrip } from "@/features/doses/strip";
import { WeekChart } from "@/features/doses/week-chart";
import "@/features/doses/strings";
import { PhotoMedicines, usePhotoMedicines } from "@/features/doses/photo";
import "@/features/messages/strings";
import { DOCK_SPACE } from "@/lib/dock";
import { Sunbeam } from "@/lib/halftone";
import { tFor, useLang } from "@/lib/i18n";
import { Text } from "@/lib/text";
import { motion, palette, space, type } from "@/lib/theme";
import { Button, Card, HoldButton, LoadError, pillStyle, QuickKey, Section, surfaceStyle, Title } from "@/lib/ui";
import { now as clockNow } from "@/lib/clock";

/** The tick, drawn from its short stroke (4,12 → 9,17 → 20,6). */
const CHECK = "M4 12l5 5L20 6";
const SNOOZE = 15 * 60_000;
const open = (name: string) => router.push({ pathname: "/medicine", params: { name } });
// The tab rises in once per launch, not every time the patient comes back to it.
let shown = false;

/**
 * Medicine (the AI Health Companion kit's "Today's Medicines" and "Time to take Medicines"): one
 * insight line on today and the week as bars of doses taken per day, then the one feature card for the next dose: time,
 * the medicine drawn big, how to take it, and a hold to mark it taken, or, once it is due, "Remind me later", which
 * steps the card aside for 15 min and sets a reminder. When nothing is due the same card says what is next.
 * Below, every medicine as one list (a finished course last, marked so; rows opening their sheets), photo medicines,
 * then the care team one tap away. A dose reminder opens this screen with its dose (`key`), so the card holds that dose until it is taken.
 */
export default function DoseScreen() {
  const now = useNow();
  const lang = useLang(), t = tFor(lang);
  const { key } = useLocalSearchParams<{ key?: string }>();
  const { plan, dose: next, taken = [], meds } = useNextDose(now);
  const dose = doseOf(meds, key, taken) ?? next;
  const discharge = useDischarge();
  const reduced = useReducedMotion();
  const [first] = useState(() => !shown);
  useEffect(() => { shown = true; }, []);
  const enter = (i: number) => first ? rise(reduced, i) : undefined;
  const [took, setTook] = useState<{ dose: Dose; at: Date }>();
  const [adding, setAdding] = useState(false);
  const out = plan?.status === "discharged" ? plan.dischargedAt : undefined;
  const today = dosesToday(meds, out, taken, now);
  const line = out ? insight(today, now, lang) : undefined;
  const week = out && meds.some(m => m.at?.length) ? weekStrip(weekOf(meds, out, taken, now), now, lang) : undefined;
  const missed = week?.some(d => d.mark === "amber") ?? false;

  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.edge, paddingTop: space.top, paddingBottom: DOCK_SPACE, gap: space.stack }}>
    <Animated.View entering={enter(0)} style={{ gap: 14 }}>
      <Title greeting={t("dose.titleLight")} accent={t("dose.titleBold")} line={line?.text} lineTone={line?.tone} />
      {week && <WeekChart days={week} height={96} interactive />}
      {/* A missed day shows in the bars above, so what to do about it sits right there, not at the foot of the page. */}
      {missed && <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderRadius: 16, borderCurve: "continuous", backgroundColor: palette.amberWash }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: palette.warning }} />
        <Text style={{ flex: 1, ...type.footnote, fontWeight: "500", color: palette.amber }}>{t("dose.missedTip")}</Text>
      </View>}
    </Animated.View>

    {!plan ? (discharge.error ? <LoadError query={discharge} /> : <ActivityIndicator color={palette.muted} />)
      : !out ? <Card>
        <Text style={{ ...type.headline, color: palette.ink }}>{t("dose.notHomeTitle")}</Text>
        <Text style={{ ...type.body, color: palette.muted }}>{t("dose.notHomeLine")}</Text>
      </Card>
      : <>
        <Animated.View entering={enter(1)}>
          <NextCard dose={dose} now={now} took={took} onTook={d => setTook({ dose: d, at: clockNow() })} />
        </Animated.View>

        {/* Asked here, where doses are, and only once. */}
        {meds.some(m => m.at?.length) && <Animated.View entering={enter(2)}><RemindCard /></Animated.View>}

        {/* Everything to do here, in one 2×2 shelf of quick-action keys with live status (Sona's quick actions). */}
        <Animated.View entering={enter(2)}><Shelf planned={meds.map(m => m.name)} onAdd={() => setAdding(true)} timed={meds.some(m => m.at?.length)} /></Animated.View>

        {/* One list, like My plan's, so no card is left alone in a row. */}
        <Animated.View entering={enter(3)} style={{ gap: 12 }}>
          <Section light={t("dose.yourLight")} bold={t("dose.yourBold")} />
          {meds.length ? <View style={[surfaceStyle, { paddingHorizontal: 14 }]}>
            {[...meds].sort((a, b) => Number(!!a.finished) - Number(!!b.finished)).map((m, i) => <MedRow key={m.name} med={m} first={i === 0} today={today.filter(d => d.name === m.name)} />)}
          </View> : <Text style={{ ...type.body, color: palette.muted }}>{t("dose.nothingAtHome")}</Text>}
        </Animated.View>
        {/* A medicine from a photo waits here for the care team (unless the plan already lists it); its sheet opens from the shelf. */}
        <Animated.View entering={enter(4)}><PhotoMedicines planned={meds.map(m => m.name)} adding={adding} onDone={() => setAdding(false)} /></Animated.View>

        {!missed && <Text style={{ ...type.footnote, color: palette.muted, textAlign: "center" }}>{t("dose.missedTip")}</Text>}
      </>}
  </ScrollView>;
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
 * The one feature card. From 2 h before until 6 h late (as everywhere): "Time to take" with the hold, and
 * "Remind me later" once it is due (from 30 min before). Earlier, "Next up" with the quiet "Took it early?"
 * hold, since logging it clears its reminder. Snoozed: when it comes back. Just taken: a popped check and what
 * is next. Nothing on a timer: says so.
 */
function NextCard({ dose, now, took, onTook }: { dose?: Dose; now: Date; took?: { dose: Dose; at: Date }; onTook: (d: Dose) => void }) {
  const lang = useLang(), t = tFor(lang);
  const snoozed = useSnooze();
  const [asking, setAsking] = useState(false);
  // The next open dose can always be logged: when it was taken is the patient's to say, not a window of ours.
  const due = dose;
  const soon = due && early(due.dueAt, now);
  const resting = due && snoozed?.key === due.key && snoozed.until > now.getTime() ? snoozed : undefined;
  // Just logged: the done state holds until the next dose is itself due.
  const logged = took && !due ? took : undefined;

  if (due && !resting) {
    const late = isLate(due.dueAt, now) ? untilLine(due.dueAt, now, lang) : undefined;
    const food = foodOf(due.line);
    return <Card feature style={{ alignItems: "center", gap: 12 }}>
      <View accessible accessibilityLabel={t("dose.timeToTakeA11y", { name: due.name, time: clock(due.dueAt, lang), late: late ? `, ${late}` : "", line: due.line })} style={{ alignItems: "center", gap: 10, alignSelf: "stretch" }}>
        <Text style={{ ...type.footnote, fontWeight: "500", color: palette.faint }}>{soon ? t("dose.nextUp") : t("dose.timeToTake")}</Text>
        <Capsule tone={late ? "amber" : undefined}>{late ? `${clock(due.dueAt, lang)} · ${late}` : clock(due.dueAt, lang)}</Capsule>
        <Pill name={due.name} size={132} />
        <Text style={nameStyle}>{due.name}</Text>
        <Text style={centred}>{sentenceCase(due.line)}</Text>
        {food && <Food when={food} />}
      </View>
      <View style={{ alignSelf: "stretch", marginTop: 4 }}>
        <HoldButton key={due.key} quiet={soon} label={t(soon ? "dose.holdEarly" : "dose.hold")} doneLabel={t("dose.taken", { name: due.name })} onDone={() => { markTaken(due.key); onTook(due); }} />
      </View>
      {dueNow(due.dueAt, now) && <Pressable accessibilityRole="button" accessibilityHint={t("dose.laterHint")} onPress={() => setAsking(true)}
        style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: 16, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
        <Text style={{ fontSize: 16, fontWeight: "500", color: palette.muted }}>{t("dose.later")}</Text>
      </Pressable>}
      <RemindSheet visible={asking} name={due.name} onClose={() => setAsking(false)} onRemind={() => {
        const until = clockNow().getTime() + SNOOZE;
        snooze({ key: due.key, until });
        askOnce();
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
 * (after Canopi's sheet); an orange ! badge, one honest line (a notification, or only in the app while
 * the phone blocks them), black "Remind in 15 min", Cancel.
 */
function RemindSheet({ visible, name, onRemind, onClose }: { visible: boolean; name: string; onRemind: () => void; onClose: () => void }) {
  const t = tFor(useLang());
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const blocked = useReminders().permission === "denied";
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
        <Text style={centred}>{t(blocked ? "dose.remindLineOpen" : "dose.remindLine", { name })}</Text>
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

const AnimatedPath = Animated.createAnimatedComponent(Path);
/** The tick's stroke length, for drawing it. */
const CHECK_LENGTH = 23;

/**
 * A green disc with a white check; `pop` springs it in (the dose just logged) and draws the tick short
 * stroke first, just behind the disc (60fps particle-news-step-check-animation). Still under Reduce Motion.
 */
function Check({ size, pop, style }: { size: number; pop?: boolean; style?: ViewStyle }) {
  const reduced = useReducedMotion();
  const drawn = useSharedValue(pop && !reduced ? CHECK_LENGTH : 0);
  useEffect(() => { drawn.value = withDelay(90, withTiming(0, { duration: 260, easing: EASE_OUT })); }, [drawn]);
  const tick = useAnimatedProps(() => ({ strokeDashoffset: drawn.value }));
  return <Animated.View entering={pop && !reduced ? checkIn : undefined} style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: palette.success, alignItems: "center", justifyContent: "center" }, style]}>
    <Svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24"><AnimatedPath d={CHECK} animatedProps={tick} strokeDasharray={CHECK_LENGTH} fill="none" stroke={palette.white} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" /></Svg>
  </Animated.View>;
}

/**
 * The Medicine tab's quick actions, one 2×2 shelf (after Sona Pro's quick-action keys): add a medicine from a photo (how many
 * wait for the care team), the full plan (since when), the care team (a new reply, or how soon they reply) and dose
 * reminders (a real switch, in place; a phone that blocks them opens Settings).
 */
function Shelf({ planned, onAdd, timed }: { planned: string[]; onAdd: () => void; timed: boolean }) {
  const lang = useLang(), t = tFor(lang);
  const plan = useDischarge().data;
  const waitingCount = usePhotoMedicines(planned).filter(m => m.status !== "added").length;
  const reply = useMessageNeeds() > 0;
  return <View style={{ gap: 12 }}>
    <View style={{ flexDirection: "row", gap: 12 }}>
      <QuickKey icon="camera" label={t("photo.add")} hint={t("photo.addLine")} onPress={onAdd}
        status={waitingCount ? t("photo.waitingCount", { n: waitingCount }) : t("photo.addShort")} tone={waitingCount ? "attention" : undefined} />
      <QuickKey icon="doc" label={t("dose.fullPlan")} hint={t("dose.fullPlanHint")} onPress={() => router.push("/discharge")}
        status={plan?.status === "discharged" ? t("dose.planSince", { day: dayLabel(plan.dischargedAt, lang) }) : t("dose.fullPlanShort")} />
    </View>
    <View style={{ flexDirection: "row", gap: 12 }}>
      <QuickKey icon="chat" label={t("dose.careTeam")} hint={t("dose.messageTeam")} onPress={() => router.push("/messages")}
        status={reply ? t("dose.newReply") : t("dose.repliesShort")} tone={reply ? "news" : undefined} />
      {timed ? <RemindersKey /> : <View style={{ flex: 1 }} />}
    </View>
  </View>;
}

/**
 * One medicine in the list (My plan's row): its pill on its tint, name and schedule, a faint ring while
 * today's doses of it are still open and a green check once they are taken; opens its sheet. When the
 * last dose is taken here, in its sheet or on home, the ring shrinks away as the check pops and draws, and
 * the name settles (a 3 pt dip back to rest). Never on mount: a row already done just shows its check. A finished
 * course reads "Finished Thu 1 Oct", with nothing left to take.
 */
function MedRow({ med, first, today }: { med: Med; first: boolean; today: DayDose[] }) {
  const lang = useLang(), t = tFor(lang);
  const reduced = useReducedMotion();
  const done = today.length > 0 && today.every(d => d.taken), schedule = scheduleLine(med, lang);
  // The next of today's doses still to take, and whether it is past its time.
  const pending = med.finished ? undefined : today.find(d => !d.taken), late = pending ? isLate(pending.dueAt, clockNow()) : false;
  const [doneAtMount] = useState(done);
  const pop = done && !doneAtMount;
  const settle = useSharedValue(0);
  useEffect(() => { if (pop && !reduced) settle.value = withSequence(withTiming(3, { duration: 120, easing: EASE_OUT }), withSpring(0, motion.pop)); }, [pop, reduced, settle]);
  const settled = useAnimatedStyle(() => ({ transform: [{ translateY: settle.value }] }));
  return <Pressable accessibilityRole="button" accessibilityLabel={[med.name, schedule, done ? t("dose.todayTaken") : pending && clock(pending.dueAt, lang)].filter(Boolean).join(". ")} accessibilityHint={t("dose.openHint")} onPress={() => open(med.name)}
    style={({ pressed }) => ({ minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderTopWidth: first ? 0 : 1, borderColor: palette.line, opacity: pressed ? 0.6 : 1 })}>
    <View style={{ width: 48, height: 48, borderRadius: 16, borderCurve: "continuous", backgroundColor: tintOf(med.name), alignItems: "center", justifyContent: "center" }}>
      <Pill name={med.name} size={44} />
    </View>
    <Animated.View style={[{ flex: 1, gap: 2 }, settled]}>
      <Text style={{ ...type.headline, color: palette.ink }}>{med.name}</Text>
      <Text style={{ ...type.footnote, color: palette.faint }}>{schedule}</Text>
    </Animated.View>
    {done ? <Check size={24} pop={pop} /> : pending && <Animated.View exiting={reduced ? undefined : ZoomOut.duration(160)}
      style={[pillStyle, { paddingHorizontal: 10, paddingVertical: 4 }, late && { backgroundColor: palette.amberWash, borderColor: palette.amberEdge }]}>
      <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13, lineHeight: 17, fontWeight: "600", fontVariant: ["tabular-nums"], color: late ? palette.amber : palette.ink }}>{clock(pending.dueAt, lang)}</Text>
    </Animated.View>}
    <Text style={{ fontSize: 20, color: palette.faint }}>›</Text>
  </Pressable>;
}
