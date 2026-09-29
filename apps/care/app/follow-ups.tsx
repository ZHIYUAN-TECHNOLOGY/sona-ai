import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";
import { useCheckIns } from "@/features/check-ins/today";
import { EASE_OUT, rise, useNextDose, useNow } from "@/features/doses";
import { clock, dosesToday, weekOf } from "@/features/doses/model";
import {
  agendaOf, away, bringLine, dateOf, dayA11y, dayLabel, dayOf, emptyLine, marksByDay, nextUp, nextVisit, openRequests, pillLine, scheduleLine, weekAround, weekdayOf, weekLabel,
  type AgendaItem, type BookingRequest, type DayMarks, type FollowUp,
} from "@/features/follow-ups/lines";
import { tFor, useLang, type Lang } from "@/lib/i18n";
import { useBookingRequests, useFollowUps } from "@/features/follow-ups/row";
import { Capsule, Stop, STOP_TITLE, Timeline } from "@/features/follow-ups/timeline";
import { removeQuestion, saveQuestion, useQuestions, useSentQuestions } from "@/features/questions";
import { DOCK_SPACE } from "@/lib/dock";
import { AnimatedText, Text, TextInput } from "@/lib/text";
import { palette, space, type } from "@/lib/theme";
import { Button, Card, Chip, CircleButton, field, ICON, surfaceStyle, Title, LoadError } from "@/lib/ui";

// Motion: the screen rises in on a 40 ms ease-out stagger, and the timeline's stops rise again the
// same way whenever the chosen day changes (after 60fps' Vakitler list fade-in). Still under Reduce Motion.
const NEXT = "m9 18l6-6l-6-6";
const TONE = { muted: palette.muted, blue: palette.blue, amber: palette.amber, green: palette.green } as const;
const labelOf = (day: number, lang: Lang) => dayLabel(new Date(day * 86_400_000), lang); // "Sun 4 Oct"

/**
 * Schedule (the kit's "Schedules"): a round + to book a visit, "Schedule" with the insight line (what is
 * next today, when the next visit is), a 7-day strip (today ringed, the chosen day filled ink; dots: blue
 * visit, violet check-in, green all doses taken, amber some missed or overdue), then the chosen day as the
 * kit's timeline: a hairline with a dot per stop (blue for the next, grey after, a green check once done),
 * each stop a card with its time capsule, title, one line and at most one inline action. The next visit
 * is the one feature card (Before you go, questions for the doctor), on its day, else under the timeline.
 * Visits asked for in Find a doctor sit under the strip as Requests until the care team decides.
 */
export default function ScheduleScreen() {
  const query = useFollowUps(), { data, error, isLoading } = query;
  const checkIns = useCheckIns().data ?? [];
  const now = useNow();
  const { plan, meds, taken } = useNextDose(now);
  const still = useReducedMotion();
  const lang = useLang(), t = tFor(lang);
  const requests = openRequests(useBookingRequests().data ?? [], now);

  const today = dayOf(now);
  const [picked, setPicked] = useState<number>();
  const day = picked ?? today;

  const visits = data ?? [], next = nextVisit(data);
  const dischargedAt = plan?.status === "discharged" ? plan.dischargedAt : undefined;
  const marks = marksByDay(today, visits, checkIns, weekOf(meds, dischargedAt, taken, now));
  const on = (d: number) => ({ visits: visits.filter(f => dayOf(f.date) === d), checkIns: checkIns.filter(c => dayOf(c.dueAt) === d) });
  const todayItems = agendaOf(now, { ...on(today), doses: dosesToday(meds, dischargedAt, taken, now) }, lang);
  const items = day === today ? todayItems : agendaOf(now, { ...on(day), doses: [], doseMark: marks[day]?.doses }, lang);
  const insight = data && scheduleLine(todayItems, visits, lang);

  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
    contentContainerStyle={{ padding: space.edge, paddingTop: space.top, paddingBottom: DOCK_SPACE, gap: space.stack }}>
    <Animated.View entering={rise(still, 0)} style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <CircleButton d={ICON.plus} label={t("fu.book")} onPress={() => router.push("/doctors")} />
      </View>
      <Title accent={t("fu.title")} line={insight?.line} lineTone={insight?.tone} />
      {isLoading && <ActivityIndicator color={palette.muted} style={{ alignSelf: "flex-start" }} />}
      {!data && error && <LoadError query={query} />}
    </Animated.View>

    <Animated.View entering={rise(still, 1)}>
      <WeekStrip day={day} today={today} marks={marks} still={still} onPick={setPicked} a11y={d => dayA11y(d, today, visits, checkIns, marks[d], lang)} />
    </Animated.View>

    {requests.length > 0 && <Animated.View entering={rise(still, 2)} style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={{ ...type.overline, color: palette.faint }}>{t("fu.requests")}</Text>
      {requests.map(r => <RequestCard key={r.id} r={r} />)}
    </Animated.View>}

    <Agenda key={day} day={day} today={today} still={still} items={items} next={next} onJump={setPicked} upNext={nextUp(day, visits, checkIns, lang)} />

    {next && dayOf(next.date) !== day && <Animated.View entering={rise(still, 3)} style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={{ ...type.overline, color: palette.faint }}>{t("fu.nextVisit")}</Text>
      <VisitCard f={next} still={still} />
    </Animated.View>}
  </ScrollView>;
}

/** The week around the chosen day: its dates, ‹ › a week at a time, and Today when elsewhere. */
function WeekStrip({ day, today, marks, still, onPick, a11y }: {
  day: number; today: number; marks: Record<number, DayMarks>; still: boolean; onPick: (d: number) => void; a11y: (d: number) => string;
}) {
  const lang = useLang(), t = tFor(lang);
  const week = weekAround(day);
  return <View style={[surfaceStyle, { backgroundColor: palette.white, paddingHorizontal: 6, paddingVertical: 10, gap: 4 }]}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 12, paddingRight: 4 }}>
      <Text accessibilityRole="header" style={{ ...type.footnote, flex: 1, fontWeight: "600", color: palette.muted }}>{weekLabel(week, lang)}</Text>
      {day !== today && <Pressable accessibilityRole="button" accessibilityLabel={t("fu.goToday")} onPress={() => onPick(today)}
        style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 8, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
        <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>{t("fu.today")}</Text>
      </Pressable>}
      <CircleButton d={ICON.back} size={40} label={t("fu.prevWeek")} onPress={() => onPick(day - 7)} />
      <CircleButton d={NEXT} size={40} label={t("fu.nextWeek")} onPress={() => onPick(day + 7)} />
    </View>
    <Animated.View key={week[0]} entering={still ? undefined : FadeIn.duration(220).easing(EASE_OUT)} style={{ flexDirection: "row" }}>
      {week.map(d => <DayChip key={d} d={d} weekday={weekdayOf(d, lang)}today={d === today} selected={d === day} marks={marks[d]} label={a11y(d)} onPress={() => onPick(d)} />)}
    </Animated.View>
  </View>;
}

function DayChip({ d, weekday, today, selected, marks, label, onPress }: { d: number; weekday: string; today: boolean; selected: boolean; marks?: DayMarks; label: string; onPress: () => void }) {
  const dots = [marks?.visit && (marks.visit === "missed" ? palette.warning : palette.info), marks?.checkIn && palette.feature,
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
  const lang = useLang(), t = tFor(lang);
  const [open, setOpen] = useState<string>();
  const lead = day >= today ? items.findIndex(i => !i.done) : -1;
  return <View style={{ gap: 12 }}>
    <AnimatedText entering={rise(still, 0)} accessibilityRole="header" style={{ ...type.overline, color: palette.faint }}>
      {day === today ? t("fu.todayLabel", { day: labelOf(day, lang) }) : labelOf(day, lang)}
    </AnimatedText>
    {!items.length ? <Animated.View entering={rise(still, 1)} style={[surfaceStyle, { padding: 22, gap: 12 }]}>
      <Text style={STOP_TITLE}>{t("fu.free")}</Text>
      <Text style={{ ...type.body, color: palette.muted }}>{emptyLine(day, today, upNext, lang)}</Text>
      {upNext &&<View style={{ alignSelf: "flex-start" }}><Chip label={t("fu.goTo", { day: labelOf(upNext.day, lang) })} dot={palette.info} onPress={() => onJump(upNext.day)} /></View>}
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
  const lang = useLang(), t = tFor(lang);
  const time = item.at ? clock(item.at, lang) : t("fu.allDay");
  const act = item.action === "take" ? { label: t("fu.takeNow"), onPress: () => router.push("/dose") }
    : item.action === "answer" ? { label: t("fu.answerNow"), onPress: () => router.navigate("/") }
      : item.action === "prepare" ? { label: expanded ? t("fu.hide") : t("fu.beforeYouGo"), onPress: onToggle } : undefined;
  return <View style={[surfaceStyle, { padding: 18, gap: 8 }]}>
    <View accessible accessibilityLabel={`${time}. ${item.title}. ${item.done ? t("fu.done") : ""}${item.line}`} style={{ gap: 8 }}>
      <Capsule>{time}</Capsule>
      <Text style={STOP_TITLE}>{item.title}</Text>
      <Text numberOfLines={2} style={{ ...type.body, fontWeight: item.tone === "muted" ? "400" : "600", color: TONE[item.tone] }}>{item.line}</Text>
    </View>
    {expanded && item.visit && <Animated.View entering={still ? undefined : FadeIn.duration(220).delay(60)} style={{ gap: 10 }}>
      <Text style={{ ...type.body, color: palette.ink }}>{bringLine(item.visit, lang)}</Text>
      {item.visit.status === "missed" && <Missed quiet />}
    </Animated.View>}
    {act && <Pressable accessibilityRole="button" accessibilityState={item.action === "prepare" ? { expanded } : undefined} onPress={act.onPress}
      style={({ pressed }) => ({ minHeight: 48, justifyContent: "center", alignSelf: "flex-start", marginBottom: -10, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ ...type.body, fontWeight: "600", color: palette.blue }}>{act.label}</Text>
    </Pressable>}
  </View>;
}

/** The next visit, the screen's one feature card: when, what, why, then the quick review before going. */
function VisitCard({ f, still }: { f: FollowUp; still: boolean }) {
  const lang = useLang(), t = tFor(lang);
  const tone = f.status === "missed" ? palette.amber : f.status === "due-soon" ? palette.blue : palette.muted;
  return <Card feature>
    <View accessible accessibilityLabel={t("fu.visitA11y", { title: f.title, when: pillLine(f, lang), away: f.status === "missed" ? t("fu.overdueA11y", { when: away(f.inDays, lang) }) : away(f.inDays, lang), why: f.why })} style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <Capsule>{pillLine(f, lang)}</Capsule>
        <Text style={{ ...type.footnote, flexShrink: 1, fontWeight: f.status === "upcoming" ? "400" : "600", color: tone }}>{f.status === "missed" ? t("fu.overdue") : f.status === "attended" ? t("fu.attended") : away(f.inDays, lang)}</Text>
      </View>
      <Text style={{ fontSize: 22, lineHeight: 28, letterSpacing: -0.8, fontWeight: "600", color: palette.ink }}>{f.title}</Text>
      <Text style={{ ...type.body, color: palette.muted }}>{f.why}</Text>
    </View>
    {f.status === "missed" && <Missed />}
    <Review f={f} still={still} />
  </Card>;
}

/** The quick review before the next visit: what to bring, and the questions saved for the doctor. */
function Review({ f, still }: { f: FollowUp; still: boolean }) {
  const lang = useLang(), t = tFor(lang);
  const questions = useQuestions(), sent = useSentQuestions();
  const [draft, setDraft] = useState("");
  return <View style={{ gap: 8, padding: 16, borderRadius: 24, borderCurve: "continuous", backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line }}>
    <Text accessibilityRole="header" style={{ ...type.headline, color: palette.ink }}>{t("fu.beforeYouGo")}</Text>
    <Text style={{ ...type.body, color: palette.muted }}>{bringLine(f, lang)}</Text>
    <Text style={{ ...type.body, fontWeight: "600", color: palette.ink, marginTop: 4 }}>{t("fu.questions")}{questions.length ? t("fu.saved", { n: questions.length }) : ""}</Text>
    {questions.map(q => <Animated.View key={q} entering={still ? undefined : FadeIn.duration(200)} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.body, color: palette.muted }}>“{q}”</Text>
        {sent.includes(q) && <Animated.View entering={still ? undefined : FadeIn.duration(200)}>
          <Text style={{ ...type.footnote, fontWeight: "600", color: palette.green }}>{t("fu.sentTeam")}</Text>
        </Animated.View>}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t("fu.removeQ", { q })} onPress={() => removeQuestion(q)}
        style={({ pressed }) => ({ width: 48, height: 48, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}>
        <Text style={{ fontSize: 15, color: palette.faint }}>✕</Text>
      </Pressable>
    </Animated.View>)}
    <TextInput value={draft} onChangeText={setDraft} onSubmitEditing={() => { saveQuestion(draft); setDraft(""); }}
      placeholder={t("fu.addQ")} placeholderTextColor={palette.faint} returnKeyType="done" submitBehavior="blurAndSubmit"
      accessibilityLabel={t("fu.addQLabel")} accessibilityHint={t("fu.addQHint")}style={{ ...field, backgroundColor: palette.white }} />
  </View>;
}

/**
 * A visit asked for in Find a doctor: waiting for the care team, or declined with their note and the
 * way to choose another time (the doctor's free times). A confirmed one shows as a normal visit.
 */
function RequestCard({ r }: { r: BookingRequest }) {
  const lang = useLang(), t = tFor(lang);
  const declined = r.status === "declined";
  const line = t(declined ? "fu.declined" : "fu.requested");
  return <View style={[surfaceStyle, { padding: 18, gap: 8 }]}>
    <View accessible accessibilityLabel={`${pillLine({ id: r.id, date: r.startsAt }, lang)}. ${r.doctorName}, ${r.specialty}. ${line}.${declined && r.note ? ` ${r.note}` : ""}`} style={{ gap: 8 }}>
      <Capsule>{pillLine({ id: r.id, date: r.startsAt }, lang)}</Capsule>
      <Text style={STOP_TITLE}>{r.doctorName} · {r.specialty}</Text>
      <Text style={{ ...type.body, fontWeight: "600", color: declined ? palette.amber : palette.blue }}>{line}</Text>
      {declined && r.note && <Text selectable style={{ ...type.body, color: palette.muted }}>“{r.note}”</Text>}
    </View>
    {declined && <Button label={t("fu.otherTime")} onPress={() => router.push({ pathname: "/doctor", params: { id: r.doctorId } })} />}
  </View>;
}

/** A missed visit: nobody saw her that day, so the care team is asked. */
function Missed({ quiet }: { quiet?: boolean }) {
  const t = tFor(useLang());
  return <>
    <Text style={{ ...type.body, color: palette.muted }}>{t("fu.missed")}</Text>
    <Button quiet={quiet} label={t("fu.messageTeam")} onPress={() => router.push("/messages")} />
  </>;
}
