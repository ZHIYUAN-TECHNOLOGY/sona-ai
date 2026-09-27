import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { AnimatedText, Text, TextInput } from "@/lib/text";
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, useReducedMotion } from "react-native-reanimated";
import { statusOf, type CheckIn } from "@/features/check-ins/model";
import { useCheckIns } from "@/features/check-ins/today";
import { useNextDose, useNow } from "@/features/doses";
import { clock, dosesToday, untilLine, weekOf, type DayDose } from "@/features/doses/model";
import { errorText } from "@/features/errors";
import {
  away, bringLine, dateOf, dayA11y, dayLabel, dayOf, emptyLine, marksByDay, monthGrid, monthLabel, monthOf, nextUp, pillLine, shiftMonth, visitsLine,
  type DayMarks, type FollowUp, type Month,
} from "@/features/follow-ups/lines";
import { useFollowUps } from "@/features/follow-ups/row";
import { removeQuestion, saveQuestion, useQuestions } from "@/features/questions";
import { DOCK_SPACE } from "@/lib/dock";
import { palette, type } from "@/lib/theme";
import { Button, Card, Chip, CircleButton, field, ICON, pillStyle, surfaceStyle } from "@/lib/ui";

// Motion: a 40 ms staggered ease-out rise on first appearance; a month change crossfades (no slide);
// a new day's agenda fades in. All still under Reduce Motion. Cards resize on the Card's layout spring.
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const rise = (i: number) => FadeInDown.duration(360).easing(EASE_OUT).delay(i * 40);
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const NEXT = "m9 18l6-6l-6-6";
const TONE = { muted: palette.muted, blue: palette.blue, amber: palette.amber, red: palette.red, green: palette.green } as const;
type Tone = keyof typeof TONE;
const labelOf = (day: number) => dayLabel(new Date(day * 86_400_000)); // "Sun 4 Oct"
const visitDot =(f: Pick<FollowUp, "status">) => f.status === "overdue" ? palette.error : palette.info;

/**
 * Schedule (Life OS frame 7): "Schedule" with a + to book a visit and the insight line, a white month
 * calendar (today ringed, the chosen day filled blue; dots: blue visit, violet check-in, green all doses
 * taken, amber some missed), then the chosen day's agenda as rows that open their screens. The next
 * visit stays the one feature card (Before you go, questions for the doctor), in the agenda on its day,
 * else under it. An empty day says what is next and jumps there.
 */
export default function ScheduleScreen() {
  const { data, error, isLoading } = useFollowUps();
  const checkIns = useCheckIns().data ?? [];
  const now = useNow();
  const { plan, meds, taken } = useNextDose(now);
  const still = useReducedMotion();
  const enter = (i: number) => still ? undefined : rise(i);

  const today = dayOf(now);
  const [picked, setPicked] = useState<number>();
  const [month, setMonth] = useState<Month>();
  const day = picked ?? today, shown = month ?? monthOf(day);
  const pick = (d: number) => { setPicked(d); setMonth(monthOf(d)); };

  const visits = data ?? [], next = data?.[0];
  const dischargedAt = plan?.status === "discharged" ? plan.dischargedAt : undefined;
  const marks = marksByDay(today, visits, checkIns, weekOf(meds, dischargedAt, taken, now));
  const insight = data && (visitsLine(data) ?? { line: "No visits booked yet", tone: "muted" as const });

  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
    contentContainerStyle={{ padding: 20, paddingBottom: DOCK_SPACE, gap: 16 }}>
    <Animated.View entering={enter(0)} style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <Text accessibilityRole="header" style={{ ...type.display, fontSize: 34, lineHeight: 40, fontWeight: "300", color: palette.ink, flexShrink: 1 }}>Schedule</Text>
        <CircleButton d={ICON.plus} label="Book a visit" onPress={() => router.push("/doctors")} />
      </View>
      {insight && <Text style={{ ...type.body, fontWeight: insight.tone === "muted" ? "400" : "600", color: palette[insight.tone] }}>{insight.line}</Text>}
      {isLoading && <ActivityIndicator color={palette.muted} style={{ alignSelf: "flex-start" }} />}
      {error && <Text selectable style={{ ...type.body, color: palette.red }}>{errorText(error)}</Text>}
    </Animated.View>

    <Animated.View entering={enter(1)}>
      <Calendar month={shown} day={day} today={today} marks={marks} still={still} onMonth={setMonth} onPick={pick}
        a11y={d => dayA11y(d, today, visits, checkIns, marks[d])} />
    </Animated.View>

    <Animated.View entering={enter(2)}>
      <Agenda key={day} day={day} today={today} now={now} still={still} next={next} onJump={pick}
        visits={visits.filter(f => dayOf(f.date) === day)} checkIns={checkIns.filter(c => dayOf(c.dueAt) === day)}
        doses={day === today ? dosesToday(meds, dischargedAt, taken, now) : []} doseMark={marks[day]?.doses}
        upNext={nextUp(day, visits, checkIns)} />
    </Animated.View>

    {next && dayOf(next.date) !== day && <Animated.View entering={enter(3)} style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={{ ...type.overline, color: palette.muted }}>Up next</Text>
      <VisitCard f={next} still={still} />
    </Animated.View>}
  </ScrollView>;
}

/** The white month card: Today, the month pill and ‹ ›, weekdays, then the days; the grid crossfades between months. */
function Calendar({ month, day, today, marks, still, onMonth, onPick, a11y }: {
  month: Month; day: number; today: number; marks: Record<number, DayMarks>; still: boolean;
  onMonth: (m: Month) => void; onPick: (d: number) => void; a11y: (d: number) => string;
}) {
  const onToday = day === today && monthOf(today).month === month.month && monthOf(today).year === month.year;
  return <Card style={{ paddingHorizontal: 12, gap: 8 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go to today" accessibilityState={{ disabled: onToday }} disabled={onToday} onPress={() => onPick(today)}
        style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", flex: 1, opacity: pressed ? 0.6 : 1 })}>
        <Text style={{ ...type.headline, color: onToday ? palette.ink : palette.blue }}>Today</Text>
      </Pressable>
      <View style={[pillStyle, { minHeight: 32, paddingHorizontal: 12, justifyContent: "center", backgroundColor: palette.mutedWash, borderColor: palette.mutedWash }]}>
        <AnimatedText key={`${month.year}-${month.month}`} entering={still ? undefined : FadeIn.duration(220)} accessibilityRole="header"
          style={{ fontWeight: "600", fontSize: 13, lineHeight: 18, color: palette.ink }}>{monthLabel(month, today)}</AnimatedText>
      </View>
      <CircleButton d={ICON.back} size={36} label="Previous month" onPress={() => onMonth(shiftMonth(month, -1))} />
      <CircleButton d={NEXT} size={36} label="Next month" onPress={() => onMonth(shiftMonth(month, 1))} />
    </View>
    <View style={{ flexDirection: "row" }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {WEEKDAYS.map(w => <Text key={w} maxFontSizeMultiplier={1.3} style={{ flex: 1, textAlign: "center", ...type.footnote, fontWeight: "500", color: palette.faint }}>{w}</Text>)}
    </View>
    <Animated.View key={`${month.year}-${month.month}`} entering={still ? undefined : FadeIn.duration(240).easing(EASE_OUT)} exiting={still ? undefined : FadeOut.duration(160)}>
      {monthGrid(month).map((week, w) => <View key={w} style={{ flexDirection: "row" }}>
        {week.map((d, i) => d === null ? <View key={i} style={{ flex: 1 }} />
          : <DayChip key={d} d={d} today={d === today} selected={d === day} marks={marks[d]} label={a11y(d)} onPress={() => onPick(d)} />)}
      </View>)}
    </Animated.View>
  </Card>;
}

function DayChip({ d, today, selected, marks, label, onPress }: { d: number; today: boolean; selected: boolean; marks?: DayMarks; label: string; onPress: () => void }) {
  const dots = [marks?.visit && (marks.visit === "overdue" ? palette.error : palette.info), marks?.checkIn && palette.feature,
    marks?.doses && (marks.doses === "taken" ? palette.success : palette.warning)].filter((c): c is string => !!c);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress}
    style={({ pressed }) => ({ flex: 1, minHeight: 52, alignItems: "center", justifyContent: "center", gap: 3, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
    <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center",
      backgroundColor: selected ? palette.blue : "transparent", borderWidth: today && !selected ? 1.5 : 0, borderColor: palette.blue }}>
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 15, fontWeight: selected || today ? "600" : "400", color: selected ? palette.white : today ? palette.blue : palette.ink, fontVariant: ["tabular-nums"] }}>{dateOf(d)}</Text>
    </View>
    <View style={{ height: 5, flexDirection: "row", gap: 3 }}>
      {dots.map(c => <View key={c} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: c }} />)}
    </View>
  </Pressable>;
}

/** The chosen day: visits (the next one as the feature card), check-ins, today's doses, or what is next. */
function Agenda({ day, today, now, still, next, visits, checkIns, doses, doseMark, upNext, onJump }: {
  day: number; today: number; now: Date; still: boolean; next?: FollowUp; visits: FollowUp[]; checkIns: CheckIn[]; doses: DayDose[];
  doseMark?: DayMarks["doses"]; upNext?: { day: number; title: string }; onJump: (d: number) => void;
}) {
  const [open, setOpen] = useState<string>();
  const empty = !visits.length && !checkIns.length && !doses.length && !doseMark;
  return <Animated.View entering={still ? undefined : FadeIn.duration(200)} style={{ gap: 10 }}>
    <Text accessibilityRole="header" style={{ ...type.overline, color: palette.muted }}>{day === today ? `Today · ${labelOf(day)}` : labelOf(day)}</Text>
    {empty && <View style={[surfaceStyle, { padding: 18, gap: 12 }]}>
      <Text style={{ ...type.body, color: palette.muted }}>{emptyLine(day, today, upNext)}</Text>
      {upNext && <View style={{ alignSelf: "flex-start" }}><Chip label={`Go to ${labelOf(upNext.day)}`} dot={palette.info} onPress={() => onJump(upNext.day)} /></View>}
    </View>}
    {visits.map(f => f.id === next?.id ? <VisitCard key={f.id} f={f} still={still} />
      : <Row key={f.id} dot={visitDot(f)} title={f.title} line={`${pillLine(f)} · ${f.status === "overdue" ? `overdue, due ${away(f.inDays)}` : away(f.inDays)}`}
        tone={f.status === "overdue" ? "red" : f.status === "due-soon" ? "amber" : "muted"} expanded={open === f.id} onPress={() => setOpen(open === f.id ? undefined : f.id)}>
        {open === f.id && <Animated.View entering={still ? undefined : FadeIn.duration(220).delay(80)} style={{ gap: 10, paddingTop: 4 }}>
          <Text style={{ ...type.body, color: palette.muted }}>{f.why}</Text>
          <Text style={{ ...type.body, color: palette.ink }}>{bringLine(f)}</Text>
          {f.status === "overdue" && <Missed quiet />}
        </Animated.View>}
      </Row>)}
    {checkIns.map(c => {
      const s = statusOf(c, now);
      return <Row key={c.id} dot={palette.feature} title={`Day ${c.day} check-in`} line={s.line} tone={s.tone} onPress={() => router.push("/check-ins")} />;
    })}
    {doses.map(d => <Row key={d.key} dot={d.taken ? palette.success : d.dueAt < now ? palette.warning : palette.faint} title={`${d.name} ${clock(d.dueAt)}`}
      line={d.taken ? "Taken" : d.dueAt < now ? untilLine(d.dueAt, now) : `Due ${untilLine(d.dueAt, now)}`}
      tone={d.taken ? "green" : d.dueAt < now ? "amber" : "muted"} onPress={() => router.push("/dose")} />)}
    {doseMark && <Row dot={doseMark === "taken" ? palette.success : palette.warning} title="Medicines" line={doseMark === "taken" ? "All doses taken" : "Some doses missed"}
      tone={doseMark === "taken" ? "green" : "amber"} onPress={() => router.push("/dose")} />}
  </Animated.View>;
}

/** A white agenda row: its dot, what it is, one line of state; `expanded` rows open in place instead of navigating. */
function Row({ dot, title, line, tone, onPress, expanded, children }: { dot: string; title: string; line: string; tone: Tone; onPress: () => void; expanded?: boolean; children?: ReactNode }) {
  return <Card style={{ paddingVertical: 12, paddingHorizontal: 16, gap: 0 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${line}`} accessibilityState={expanded === undefined ? undefined : { expanded }} onPress={onPress}
      style={({ pressed }) => ({ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, opacity: pressed ? 0.6 : 1 })}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.headline, color: palette.ink }}>{title}</Text>
        <Text style={{ ...type.footnote, fontWeight: tone === "muted" ? "400" : "600", color: TONE[tone] }}>{line}</Text>
      </View>
      <Text style={{ fontSize: 20, color: palette.faint, transform: [{ rotate: expanded ? "90deg" : "0deg" }] }}>›</Text>
    </Pressable>
    {children}
  </Card>;
}

/** The next visit, the screen's one feature card: when, what, why, then the quick review before going. */
function VisitCard({ f, still }: { f: FollowUp; still: boolean }) {
  const tone = f.status === "overdue" ? palette.red : f.status === "due-soon" ? palette.amber : palette.muted;
  return <Card feature>
    <View accessible accessibilityLabel={`Next visit. ${f.title}. ${pillLine(f)}, ${f.status === "overdue" ? `overdue, due ${away(f.inDays)}` : away(f.inDays)}. ${f.why}`} style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={[pillStyle, { minHeight: 32, paddingHorizontal: 12, justifyContent: "center", flexShrink: 1 }]}>
          <Text style={{ ...type.footnote, fontWeight: "600", color: palette.ink, fontVariant: ["tabular-nums"] }}>{pillLine(f)}</Text>
        </View>
        <Text style={{ ...type.footnote, flex: 1, fontWeight: f.status === "upcoming" ? "400" : "600", color: tone }}>{f.status === "overdue" ? "Overdue" : away(f.inDays)}</Text>
      </View>
      <Text style={{ ...type.title, fontWeight: "700", color: palette.ink }}>{f.title}</Text>
      <Text style={{ ...type.body, color: palette.muted }}>{f.why}</Text>
    </View>
    {f.status === "overdue" && <Missed />}
    <Review f={f} still={still} />
  </Card>;
}

/** The quick review before the next visit: what to bring, and the questions saved for the doctor. */
function Review({ f, still }: { f: FollowUp; still: boolean }) {
  const questions = useQuestions();
  const [draft, setDraft] = useState("");
  return <View style={{ gap: 8, padding: 14, borderRadius: 20, borderCurve: "continuous", backgroundColor: palette.mutedWash }}>
    <Text style={{ ...type.overline, color: palette.muted }}>Before you go</Text>
    <Text style={{ ...type.body, color: palette.ink }}>{bringLine(f)}</Text>
    <Text style={{ ...type.body, fontWeight: "700", color: palette.ink, marginTop: 4 }}>Questions for your doctor{questions.length ? ` · ${questions.length} saved` : ""}</Text>
    {questions.map(q => <Animated.View key={q} entering={still ? undefined : FadeIn.duration(200)} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Text style={{ ...type.body, flex: 1, color: palette.muted }}>“{q}”</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove question: ${q}`} onPress={() => removeQuestion(q)}
        style={({ pressed }) => ({ width: 44, height: 44, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}>
        <Text style={{ fontSize: 15, color: palette.faint }}>✕</Text>
      </Pressable>
    </Animated.View>)}
    <TextInput value={draft} onChangeText={setDraft} onSubmitEditing={() => { saveQuestion(draft); setDraft(""); }}
      placeholder="Add a question" placeholderTextColor={palette.faint} returnKeyType="done" submitBehavior="blurAndSubmit"
      accessibilityLabel="Add a question for your doctor" accessibilityHint="Saved on this phone for your visit" style={field} />
  </View>;
}

/** An overdue visit: missed or already done cannot be told apart here, so the care team is asked. */
function Missed({ quiet }: { quiet?: boolean }) {
  return <>
    <Text style={{ ...type.body, color: palette.muted }}>Missed it, or already been? Let your care team know.</Text>
    <Button quiet={quiet} label="Message my care team" onPress={() => router.push("/messages")} />
  </>;
}
