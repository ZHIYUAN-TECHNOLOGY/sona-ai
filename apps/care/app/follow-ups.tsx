import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";
import { useCheckIns } from "@/features/check-ins/today";
import { EASE_OUT, rise, useNextDose, useNow } from "@/features/doses";
import { clock, dosesToday, weekOf } from "@/features/doses/model";
import { errorText } from "@/features/errors";
import {
  agendaOf, away, bringLine, dateOf, dayA11y, dayLabel, dayOf, emptyLine, marksByDay, nextUp, pillLine, scheduleLine, weekAround, weekLabel,
  type AgendaItem, type DayMarks, type FollowUp,
} from "@/features/follow-ups/lines";
import { useFollowUps } from "@/features/follow-ups/row";
import { Capsule, Stop, STOP_TITLE, Timeline } from "@/features/follow-ups/timeline";
import { removeQuestion, saveQuestion, useQuestions } from "@/features/questions";
import { DOCK_SPACE } from "@/lib/dock";
import { AnimatedText, Text, TextInput } from "@/lib/text";
import { palette, space, type } from "@/lib/theme";
import { Button, Card, Chip, CircleButton, field, ICON, surfaceStyle, Title } from "@/lib/ui";

// Motion: the screen rises in on a 40 ms ease-out stagger, and the timeline's stops rise again the
// same way whenever the chosen day changes (after 60fps' Vakitler list fade-in). Still under Reduce Motion.
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const NEXT = "m9 18l6-6l-6-6";
const TONE = { muted: palette.muted, blue: palette.blue, amber: palette.amber, green: palette.green } as const;
const labelOf = (day: number) => dayLabel(new Date(day * 86_400_000)); // "Sun 4 Oct"

/**
 * Schedule (the kit's "Schedules"): a round + to book a visit, "Schedule" with the insight line (what is
 * next today, when the next visit is), a 7-day strip (today ringed, the chosen day filled ink; dots: blue
 * visit, violet check-in, green all doses taken, amber some missed or overdue), then the chosen day as the
 * kit's timeline: a hairline with a dot per stop (blue for the next, grey after, a green check once done),
 * each stop a card with its time capsule, title, one line and at most one inline action. The next visit
 * is the one feature card (Before you go, questions for the doctor), on its day, else under the timeline.
 */
export default function ScheduleScreen() {
  const { data, error, isLoading } = useFollowUps();
  const checkIns = useCheckIns().data ?? [];
  const now = useNow();
  const { plan, meds, taken } = useNextDose(now);
  const still = useReducedMotion();

  const today = dayOf(now);
  const [picked, setPicked] = useState<number>();
  const day = picked ?? today;

  const visits = data ?? [], next = data?.[0];
  const dischargedAt = plan?.status === "discharged" ? plan.dischargedAt : undefined;
  const marks = marksByDay(today, visits, checkIns, weekOf(meds, dischargedAt, taken, now));
  const on = (d: number) => ({ visits: visits.filter(f => dayOf(f.date) === d), checkIns: checkIns.filter(c => dayOf(c.dueAt) === d) });
  const todayItems = agendaOf(now, { ...on(today), doses: dosesToday(meds, dischargedAt, taken, now) });
  const items = day === today ? todayItems : agendaOf(now, { ...on(day), doses: [], doseMark: marks[day]?.doses });
  const insight = data && scheduleLine(todayItems, visits);

  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
    contentContainerStyle={{ padding: space.edge, paddingTop: space.top, paddingBottom: DOCK_SPACE, gap: space.stack }}>
    <Animated.View entering={rise(still, 0)} style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <CircleButton d={ICON.plus} label="Book a visit" onPress={() => router.push("/doctors")} />
      </View>
      <Title accent="Schedule" line={insight?.line} lineTone={insight?.tone} />
      {isLoading && <ActivityIndicator color={palette.muted} style={{ alignSelf: "flex-start" }} />}
      {error && <Text selectable style={{ ...type.body, color: palette.red }}>{errorText(error)}</Text>}
    </Animated.View>

    <Animated.View entering={rise(still, 1)}>
      <WeekStrip day={day} today={today} marks={marks} still={still} onPick={setPicked} a11y={d => dayA11y(d, today, visits, checkIns, marks[d])} />
    </Animated.View>

    <Agenda key={day} day={day} today={today} still={still} items={items} next={next} onJump={setPicked} upNext={nextUp(day, visits, checkIns)} />

    {next && dayOf(next.date) !== day && <Animated.View entering={rise(still, 3)} style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={{ ...type.overline, color: palette.faint }}>Next visit</Text>
      <VisitCard f={next} still={still} />
    </Animated.View>}
  </ScrollView>;
}

/** The week around the chosen day: its dates, ‹ › a week at a time, and Today when elsewhere. */
function WeekStrip({ day, today, marks, still, onPick, a11y }: {
  day: number; today: number; marks: Record<number, DayMarks>; still: boolean; onPick: (d: number) => void; a11y: (d: number) => string;
}) {
  const week = weekAround(day);
  return <View style={[surfaceStyle, { backgroundColor: palette.white, paddingHorizontal: 6, paddingVertical: 10, gap: 4 }]}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 12, paddingRight: 4 }}>
      <Text accessibilityRole="header" style={{ ...type.footnote, flex: 1, fontWeight: "600", color: palette.muted }}>{weekLabel(week)}</Text>
      {day !== today && <Pressable accessibilityRole="button" accessibilityLabel="Go to today" onPress={() => onPick(today)}
        style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 8, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
        <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>Today</Text>
      </Pressable>}
      <CircleButton d={ICON.back} size={40} label="Previous week" onPress={() => onPick(day - 7)} />
      <CircleButton d={NEXT} size={40} label="Next week" onPress={() => onPick(day + 7)} />
    </View>
    <Animated.View key={week[0]} entering={still ? undefined : FadeIn.duration(220).easing(EASE_OUT)} style={{ flexDirection: "row" }}>
      {week.map((d, i) => <DayChip key={d} d={d} weekday={WEEKDAYS[i]!} today={d === today} selected={d === day} marks={marks[d]} label={a11y(d)} onPress={() => onPick(d)} />)}
    </Animated.View>
  </View>;
}

function DayChip({ d, weekday, today, selected, marks, label, onPress }: { d: number; weekday: string; today: boolean; selected: boolean; marks?: DayMarks; label: string; onPress: () => void }) {
  const dots = [marks?.visit && (marks.visit === "overdue" ? palette.warning : palette.info), marks?.checkIn && palette.feature,
    marks?.doses && (marks.doses === "taken" ? palette.success : palette.warning)].filter((c): c is string => !!c);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress}
    style={({ pressed }) => ({ flex: 1, minHeight: 76, alignItems: "center", justifyContent: "center", gap: 4, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
    <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, lineHeight: 16, fontWeight: "500", color: palette.faint }}>{weekday}</Text>
    <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center",
      backgroundColor: selected ? palette.dark : "transparent", borderWidth: today && !selected ? 1.5 : 0, borderColor: palette.info }}>
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 16, fontWeight: selected || today ? "600" : "400", color: selected ? palette.white : palette.ink, fontVariant: ["tabular-nums"] }}>{dateOf(d)}</Text>
    </View>
    <View style={{ height: 5, flexDirection: "row", gap: 3 }}>
      {dots.map((c, i) => <View key={i} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: c }} />)}
    </View>
  </Pressable>;
}

/** The chosen day as the kit's timeline; an empty day reassures and jumps to what is next. */
function Agenda({ day, today, still, items, next, upNext, onJump }: {
  day: number; today: number; still: boolean; items: AgendaItem[]; next?: FollowUp; upNext?: { day: number; title: string }; onJump: (d: number) => void;
}) {
  const [open, setOpen] = useState<string>();
  const lead = day >= today ? items.findIndex(i => !i.done) : -1;
  return <View style={{ gap: 12 }}>
    <AnimatedText entering={rise(still, 0)} accessibilityRole="header" style={{ ...type.overline, color: palette.faint }}>
      {day === today ? `Today · ${labelOf(day)}` : labelOf(day)}
    </AnimatedText>
    {!items.length ? <Animated.View entering={rise(still, 1)} style={[surfaceStyle, { padding: 22, gap: 12 }]}>
      <Text style={STOP_TITLE}>A free day. Rest up.</Text>
      <Text style={{ ...type.body, color: palette.muted }}>{emptyLine(day, today, upNext)}</Text>
      {upNext &&<View style={{ alignSelf: "flex-start" }}><Chip label={`Go to ${labelOf(upNext.day)}`} dot={palette.info} onPress={() => onJump(upNext.day)} /></View>}
    </Animated.View>
    : <Timeline line={items.length > 1}>
      {items.map((item, i) => <Stop key={item.key} index={i + 1} still={still} done={item.done} lead={i === lead}>
        {item.visit && item.visit.id === next?.id ? <VisitCard f={item.visit} still={still} />
          : <Entry item={item} expanded={open === item.key} onToggle={() => setOpen(open === item.key ? undefined : item.key)} still={still} />}
      </Stop>)}
    </Timeline>}
  </View>;
}

/** A stop's card: the white time capsule, title, one line, and at most one inline action. */
function Entry({ item, expanded, onToggle, still }: { item: AgendaItem; expanded: boolean; onToggle: () => void; still: boolean }) {
  const time = item.at ? clock(item.at) : "All day";
  const act = item.action === "take" ? { label: "Take now", onPress: () => router.push("/dose") }
    : item.action === "answer" ? { label: "Answer now", onPress: () => router.navigate("/") }
      : item.action === "prepare" ? { label: expanded ? "Hide" : "Before you go", onPress: onToggle } : undefined;
  return <View style={[surfaceStyle, { padding: 18, gap: 8 }]}>
    <View accessible accessibilityLabel={`${time}. ${item.title}. ${item.done ? "Done. " : ""}${item.line}`} style={{ gap: 8 }}>
      <Capsule>{time}</Capsule>
      <Text style={STOP_TITLE}>{item.title}</Text>
      <Text numberOfLines={2} style={{ ...type.body, fontWeight: item.tone === "muted" ? "400" : "600", color: TONE[item.tone] }}>{item.line}</Text>
    </View>
    {expanded && item.visit && <Animated.View entering={still ? undefined : FadeIn.duration(220).delay(60)} style={{ gap: 10 }}>
      <Text style={{ ...type.body, color: palette.ink }}>{bringLine(item.visit)}</Text>
      {item.visit.status === "overdue" && <Missed quiet />}
    </Animated.View>}
    {act && <Pressable accessibilityRole="button" accessibilityState={item.action === "prepare" ? { expanded } : undefined} onPress={act.onPress}
      style={({ pressed }) => ({ minHeight: 48, justifyContent: "center", alignSelf: "flex-start", marginBottom: -10, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ ...type.body, fontWeight: "600", color: palette.blue }}>{act.label}</Text>
    </Pressable>}
  </View>;
}

/** The next visit, the screen's one feature card: when, what, why, then the quick review before going. */
function VisitCard({ f, still }: { f: FollowUp; still: boolean }) {
  const tone = f.status === "overdue" ? palette.amber : f.status === "due-soon" ? palette.blue : palette.muted;
  return <Card feature>
    <View accessible accessibilityLabel={`Next visit. ${f.title}. ${pillLine(f)}, ${f.status === "overdue" ? `overdue, due ${away(f.inDays)}` : away(f.inDays)}. ${f.why}`} style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Capsule>{pillLine(f)}</Capsule>
        <Text style={{ ...type.footnote, flex: 1, fontWeight: f.status === "upcoming" ? "400" : "600", color: tone }}>{f.status === "overdue" ? "Overdue" : away(f.inDays)}</Text>
      </View>
      <Text style={{ fontSize: 22, lineHeight: 28, letterSpacing: -0.8, fontWeight: "600", color: palette.ink }}>{f.title}</Text>
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
  return <View style={{ gap: 8, padding: 16, borderRadius: 24, borderCurve: "continuous", backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line }}>
    <Text accessibilityRole="header" style={{ ...type.headline, color: palette.ink }}>Before you go</Text>
    <Text style={{ ...type.body, color: palette.muted }}>{bringLine(f)}</Text>
    <Text style={{ ...type.body, fontWeight: "600", color: palette.ink, marginTop: 4 }}>Questions for your doctor{questions.length ? ` · ${questions.length} saved` : ""}</Text>
    {questions.map(q => <Animated.View key={q} entering={still ? undefined : FadeIn.duration(200)} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Text style={{ ...type.body, flex: 1, color: palette.muted }}>“{q}”</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove question: ${q}`} onPress={() => removeQuestion(q)}
        style={({ pressed }) => ({ width: 48, height: 48, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}>
        <Text style={{ fontSize: 15, color: palette.faint }}>✕</Text>
      </Pressable>
    </Animated.View>)}
    <TextInput value={draft} onChangeText={setDraft} onSubmitEditing={() => { saveQuestion(draft); setDraft(""); }}
      placeholder="Add a question" placeholderTextColor={palette.faint} returnKeyType="done" submitBehavior="blurAndSubmit"
      accessibilityLabel="Add a question for your doctor" accessibilityHint="Saved on this phone for your visit" style={{ ...field, backgroundColor: palette.white }} />
  </View>;
}

/** An overdue visit: missed or already done cannot be told apart here, so the care team is asked. */
function Missed({ quiet }: { quiet?: boolean }) {
  return <>
    <Text style={{ ...type.body, color: palette.muted }}>Missed it, or already been? Let your care team know.</Text>
    <Button quiet={quiet} label="Message my care team" onPress={() => router.push("/messages")} />
  </>;
}
