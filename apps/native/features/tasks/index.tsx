import { PressScale } from "@/components/sona/parts";
import { Text } from "@/components/sona/text";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Pressable, Text as RNText, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cubicBezier, FadeIn, FadeOut, interpolate, withTiming, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { scheduleOnRN } from "react-native-worklets";
import { BrandIcon } from "@/components/sona/brand-icon";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { Action, Chip, Expand, glass, Icon, Insight, Notice, RoundAction, Screen, SourceLink, Surface, Tone, useAccessibleEffects } from "@/components/sona/ui";
import { Section as AnswerSection } from "@/components/sona/sections";
import { HalftoneGlint } from "@/components/sona/halftone-shimmer";
import { palette, type, radius } from "@/components/sona/theme";
import { useEncounterSelect } from "@/features/encounter/store";
import { sameShallow } from "@/features/live/keep-same";
import type { Encounter, FeatureProps, Patient, Task } from "@/features/encounter/types";
import { api, errorText, requestId, useLive } from "@/features/live";
import { LockedAction, useRole } from "@/features/live/roles";
import { completeServerTask, createServerTask, refreshServerData, useServerData, useVisitTasks } from "@/features/live/server-day";
import { dueGroup, rankByDue, taskCounts } from "./counts";
import { ASK_SPACE, WithSona } from "@/features/ask";
import { overdue } from "@/features/ask/answers";
import { changeReceipt, createTaskOnce, dayFromToday, dueRuler, friendlyDate, localDate, longDate, MONTHS, mentionQuery, parseDuePhrase, proposedTask, taskDraftErrors, taskProposal, type TaskDraft } from "./state";

/**
 * Follow-up answer: a generated section in the tasks screen's language. Before any task exists it
 * proposes one sentence with quiet owner/due tokens and one action; afterwards it shows the counts
 * and the latest tasks as read-only rows. Every path leads to the tasks screen, where edits happen.
 */
export function FollowupCard({ patient, onOpen, onSource }: FeatureProps) {
  const encounter = useEncounterSelect(s => s.encounter);
  const { reducedMotion } = useAccessibleEffects();
  const tasksOf = useVisitTasks();
  const created = encounter ? tasksOf(patient) : [];
  const draft = encounter?.taskDraft;
  const proposal = draft ?? (encounter ? taskProposal(encounter, patient) : undefined);
  const open = () => onOpen("tasks");
  // Generated reveal (after Remy AI's staggered analysis): blocks rise 8 pt, 60 ms apart, ease-out.
  const rise = (i: number) => reducedMotion ? undefined : riseIn({ delay: 60 * i, distance: 8, duration: 320 });

  if (created.length) {
    const openCount = created.filter(task => !task.completed).length;
    return <AnswerSection title="Keep the next step in sight" subtitle={openCount ? `${openCount} open · ${created.length - openCount} completed` : "All follow-ups are done."}>
      <Surface feature style={{ paddingHorizontal: 18, paddingTop: 4, paddingBottom: 18, gap: 10 }}>
        <View>{created.slice(-2).map((task, i) => <Animated.View key={task.id} entering={rise(i)} style={i ? { borderTopWidth: 1, borderColor: glass.hairline } : undefined}><TaskSummary task={task} /></Animated.View>)}</View>
        <Animated.View entering={rise(2)}><Action label="Manage follow-up" icon="checklist" onPress={open} /></Animated.View>
      </Surface>
      <SessionNote />
    </AnswerSection>;
  }

  const owner = draft?.owner, due = draft?.due;
  return <AnswerSection title="A clear next step" subtitle={proposal?.sourceId === "clinical-note" ? "Taken from the plan you wrote. Give it an owner and a date to make it a task." : "Proposed from this encounter. Give it an owner and a date to make it a task."}>
    <Surface feature style={{ padding: 18, gap: 16 }}>
      <Animated.View entering={rise(0)}><Text selectable style={{ ...type.heading, fontWeight: "500", color: palette.ink }}>{proposal?.title ?? proposedTask}</Text></Animated.View>
      <Animated.View entering={rise(1)} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Chip icon={<BrandIcon name="person" size={17} color={owner ? palette.blue : palette.muted} />} label={owner || "Owner"} filled={Boolean(owner)} onPress={open} accessibilityLabel={owner ? `Owner, ${owner}` : "Owner, not assigned"} />
        <Chip icon={<BrandIcon name="calendar" size={17} color={due ? palette.blue : palette.muted} />} label={due ? friendlyDate(due) : "Due"} filled={Boolean(due)} onPress={open} accessibilityLabel={due ? `Due ${friendlyDate(due)}` : "Due date, not set"} />
      </Animated.View>
      <Animated.View entering={rise(2)}><Action label="Make it a task" icon="calendar.badge.plus" onPress={open} /></Animated.View>
    </Surface>
    {proposal ? <TaskOrigin value={proposal} local /> : <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 6 }}><SourceLink label="Encounter context" onPress={() => onSource("history")} /><SessionNote /></View>}
  </AnswerSection>;
}

/** Read-only task row with the tasks screen's check: filled circle and struck title once done. */
function TaskSummary({ task }: { task: Task }) {
  const done = task.completed;
  return <View style={{ flexDirection: "row", gap: 12, paddingVertical: 12 }}>
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 22, height: 22, marginTop: 1, borderRadius: 11, borderWidth: 1.6, borderColor: done ? palette.blue : palette.line, backgroundColor: done ? palette.blue : "transparent", alignItems: "center", justifyContent: "center" }}>
      {done && <BrandIcon name="check" size={14} color={palette.white} strokeWidth={2.4} />}
    </View>
    <View style={{ flex: 1, gap: 3 }}>
      <Text selectable accessibilityLabel={`${task.title}, ${done ? "completed" : "open"}`} style={{ ...type.body, lineHeight: 22, fontWeight: "500", color: done ? palette.muted : palette.ink, textDecorationLine: done ? "line-through" : "none", textDecorationColor: palette.muted }}>{task.title}</Text>
      <Text selectable style={{ ...type.footnote, color: palette.muted }}>{ownerLine(task, done)}</Text>
      <TaskOrigin value={task} />
    </View>
  </View>;
}

/** The simulation boundary, said once per screen as one quiet line; saved tasks need no note. */
function SessionNote() {
  const { on: live } = useLive();
  return live ? null : <Text selectable style={{ ...type.caption, lineHeight: 18, color: palette.muted }}>Local simulation · nothing is booked or sent</Text>;
}

/** One quiet line: who wrote it, its source at the revision it was taken from, and (with `local`) the simulation note. */
function TaskOrigin({ value, local = false }: { value: Pick<Task, "sourceId" | "sourceRevision" | "provenance" | "sourceSnapshot"> & { id?: string; operationId?: string }; local?: boolean }) {
  const patient = useEncounterSelect(s => s.patient);
  const source = value.sourceSnapshot ?? patient?.sources.find(item => item.id === value.sourceId);
  const origin = value.provenance === "clinician" ? "Clinician-entered details" : value.provenance === "fixture" ? "Authored sample proposal" : "Origin not recorded";
  const label = source ? `${source.title}${value.sourceRevision ? ` · revision ${value.sourceRevision}` : ""}` : "";
  return <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 6 }}>
    <Text selectable style={{ ...type.caption, lineHeight: 18, color: palette.muted }}>{origin} ·</Text>
    {source && patient ? <Pressable accessibilityRole="link" accessibilityLabel={`Source, ${label}`} hitSlop={{ top: 13, bottom: 13, left: 6, right: 12 }}
      onPress={() => router.push({ pathname: "/source", params: { id: source.id, patientId: patient.id, revision: String(value.sourceRevision ?? ""), taskId: value.id ?? value.operationId ?? "" } })}
      style={{ flexShrink: 1 }}>{({ pressed }) => <PressScale pressed={pressed} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Text style={{ ...type.caption, flexShrink: 1, lineHeight: 18, fontWeight: "500", color: palette.blue }}>{label}</Text><Icon name="arrow.up.right" size={10} color={palette.blue} />
    </PressScale>}</Pressable> : <Text selectable style={{ ...type.caption, lineHeight: 18, color: palette.muted }}>No originating source linked</Text>}
    {local && <Text selectable style={{ ...type.caption, lineHeight: 18, color: palette.muted }}>· local simulation, nothing sent</Text>}
  </View>;
}

// ---- Task screen (after Superlist's sentence composer, Canopi's quick dates, Particle's check
// morph and Twodos's swipe-to-complete). State rules live in ./state and are unchanged. ----

const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
const OWNERS = ["Treating clinician", "Clinic nurse", "Care coordinator", "Pharmacist"];
const SWIPE = 88;
// The ruler has no end: it loads a year of days at a time and adds the next year before you reach it.
const TICK = 12, YEAR_OF_DAYS = 366;
/** Review intervals marked under the ruler (tap to jump); yearly anniversaries are added on the fly. */
const MILESTONES: Record<number, string> = { 0: "Today", 7: "1 wk", 14: "2 wk", 28: "4 wk", 42: "6 wk", 56: "8 wk", 84: "12 wk", 182: "6 mo" };

function haptic(kind: "select" | "done") {
  if (process.env.EXPO_OS !== "ios") return;
  (kind === "done" ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : Haptics.selectionAsync()).catch(() => {});
}
/** "Pharmacy · Tomorrow"; just the owner when a task (a server one) has no due date. */
const ownerLine = (task: Task, done = false) => [task.owner, done ? "Done" : friendlyDate(task.due)].filter(Boolean).join(" · ");

const clampDay = (i: number) => { "worklet"; return Math.max(0, Math.round(i)); };
/** Days from today to a YYYY-MM-DD date (0 for today or earlier). */
function dayIndex(due: string) { const t = new Date(); return Math.max(0, Math.round((new Date(`${due}T12:00:00`).getTime() - new Date(t.getFullYear(), t.getMonth(), t.getDate(), 12).getTime()) / 86400000)); }

function relativeDay(i: number) {
  if (i === 0) return "Today";
  if (i === 1) return "Tomorrow";
  if (i < 60) return i % 7 === 0 ? `In ${i / 7} ${i === 7 ? "week" : "weeks"}` : `In ${i} days`;
  const months = Math.round(i / 30.44);
  return months < 24 ? `In about ${months} months` : `In about ${Math.round(i / 365)} years`;
}

/**
 * Due-date ruler (after Habitastic's timeline scroll): one tick per day slides under a fixed ink
 * marker. Drag with momentum; it snaps to a day, ticks a haptic per day passed, and saves once, when
 * the finger lifts, at the day it comes to rest. Months and years are labelled above, review
 * intervals and yearly anniversaries below (tap to jump), and the native compact picker jumps
 * straight to any future date. The
 * ruler never ends: ticks are virtualised and another year loads before you reach the last one.
 */
function DayRuler({ value, onPick }: { value: string; onPick: (due: string) => void }) {
  const { reducedMotion } = useAccessibleEffects();
  const [initial] = useState(() => value ? dayIndex(value) : 0);
  // Loaded days; grows by a year whenever the end comes near, so scrolling never runs out.
  const [count, setCount] = useState(() => initial + 2 * YEAR_OF_DAYS);
  const days = useMemo(() => Array.from({ length: count }, (_, i) => dayFromToday(i)), [count]);
  const pendingJump = useRef<number | null>(null);
  const [shown, setShown] = useState(initial);
  const [width, setWidth] = useState(0);
  const ref = useAnimatedRef<Animated.FlatList<string>>();
  const x = useSharedValue(initial * TICK);
  // Only the day index crosses to React, once per day passed, never per frame.
  useAnimatedReaction(() => clampDay(x.value / TICK), (i, prev) => { if (prev !== null && i !== prev) { scheduleOnRN(setShown, i); scheduleOnRN(haptic, "select"); } });
  // One save per drag, when the finger lifts; never for the scroll that places it on open, nor for the day already saved (state.ts).
  const latest = useRef(onPick); latest.current = onPick;
  const [{ sync, drag, release, settle, jump: save }] = useState(() => dueRuler(value, TICK, due => latest.current(due)));
  useEffect(() => sync(value), [sync, value]);
  const onScroll = useAnimatedScrollHandler({
    onScroll: e => { x.set(e.contentOffset.x); },
    onBeginDrag: () => { scheduleOnRN(drag); },
    onEndDrag: e => { scheduleOnRN(release, e.targetContentOffset?.x ?? e.contentOffset.x, e.velocity?.x ?? 0); },
    onMomentumEnd: e => { scheduleOnRN(settle, e.contentOffset.x); },
  });
  const jump = (i: number, animated = !reducedMotion) => {
    const day = clampDay(i);
    // A date beyond what is loaded: load up to it (and a year past), then jump once it has rendered.
    if (day >= days.length) { pendingJump.current = day; setCount(day + YEAR_OF_DAYS); return; }
    ref.current?.scrollToOffset({ offset: day * TICK, animated }); setShown(day); save(day);
  };
  useEffect(() => { const day = pendingJump.current; if (day !== null && day < days.length) { pendingJump.current = null; jumpRef.current(day, false); } }, [days]);
  const jumpRef = useRef(jump); jumpRef.current = jump;
  const side = Math.max(0, width / 2 - TICK / 2);
  // Nothing is chosen until the clinician moves the ruler, taps an interval or picks a date.
  const unset = !value && shown === initial;
  const renderTick = useCallback(({ item: day, index: i }: { item: string; index: number }) => {
    const d = new Date(`${day}T12:00:00`), t = new Date(), first = d.getDate() === 1, week = i % 7 === 0;
    const years = d.getFullYear() - t.getFullYear();
    const label = MILESTONES[i] ?? (years > 0 && d.getMonth() === t.getMonth() && d.getDate() === t.getDate() ? `${years} yr` : undefined);
    return <View style={{ width: TICK, height: 74, alignItems: "center" }}>
      {first && <Text numberOfLines={1} style={{ ...type.caption, position: "absolute", top: 0, width: 60, left: (TICK - 60) / 2, textAlign: "center", fontWeight: "600", color: d.getMonth() === 0 ? palette.ink : palette.muted }}>{d.getMonth() === 0 ? String(d.getFullYear()) : MONTHS[d.getMonth()]}</Text>}
      <View style={{ marginTop: label || first ? 16 : week ? 21 : 25, width: 1.5, height: label || first ? 26 : week ? 21 : 17, borderRadius: 1, backgroundColor: label || first ? "rgba(20,28,40,0.32)" : week ? "rgba(20,28,40,0.2)" : "rgba(20,28,40,0.11)" }} />
      {label && <Pressable accessible={false} hitSlop={10} onPress={() => jumpRef.current(i)} style={{ position: "absolute", top: 54, width: 44, left: (TICK - 44) / 2, alignItems: "center" }}>
        <Text style={{ ...type.caption, fontWeight: "500", color: palette.muted }}>{label}</Text>
      </Pressable>}
    </View>;
  }, []);
  // Stable list props: the ruler re-renders once per day passed while dragging.
  const getItemLayout = useCallback((_: unknown, i: number) => ({ length: TICK, offset: side + TICK * i, index: i }), [side]);
  const edge = useMemo(() => <View style={{ width: side }} />, [side]);
  const loadMore = useCallback(() => setCount(value => value + YEAR_OF_DAYS), []);
  // The picker shows the saved day, not each day passed: fed a new date per tick, it sent stale ones back mid-drag, each one a save.
  const pickerDate = new Date(`${dayFromToday(value ? dayIndex(value) : initial)}T12:00:00`);
  return <View style={{ gap: 8 }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      {/* Only the readout is adjustable (swipe up/down a day); the native picker beside it stays reachable for big jumps. */}
      <View accessible accessibilityRole="adjustable" accessibilityLabel="Due date" accessibilityValue={{ text: unset ? "Not set" : `${longDate(days[shown]!)}, ${relativeDay(shown)}` }} accessibilityHint="Swipe up or down to move a day. Use the date picker to jump further."
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]} onAccessibilityAction={e => jump(shown + (e.nativeEvent.actionName === "increment" ? 1 : -1))} style={{ flex: 1 }}>
        <Text style={{ ...type.heading, color: unset ? palette.muted : palette.ink, fontVariant: ["tabular-nums"] }}>{longDate(days[shown]!)}</Text>
        <Text style={{ ...type.footnote, color: palette.muted, fontVariant: ["tabular-nums"] }}>{unset ? "Slide, tap an interval, or pick a date" : relativeDay(shown)}</Text>
      </View>
      {/* Native compact picker: its calendar popover reaches any month or year in a couple of taps. */}
      <DateTimePicker style={{ width: 124 }} value={pickerDate} mode="date" display="compact" minimumDate={new Date(`${days[0]}T00:00:00`)} themeVariant="light" accentColor={palette.blue}
        onValueChange={(_, date) => jump(dayIndex(localDate(date)), false)} />
    </View>
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ height: 74, marginHorizontal: -18 }}>
      {width > 0 && <Animated.FlatList ref={ref} horizontal data={days} keyExtractor={day => day} renderItem={renderTick}
        getItemLayout={getItemLayout} ListHeaderComponent={edge} ListFooterComponent={edge}
        initialNumToRender={80} maxToRenderPerBatch={80} windowSize={7} onEndReachedThreshold={6} onEndReached={loadMore} onScroll={onScroll} scrollEventThrottle={16} showsHorizontalScrollIndicator={false} snapToInterval={TICK} decelerationRate="fast"
        onLayout={() => { if (initial > 0) ref.current?.scrollToOffset({ offset: initial * TICK, animated: false }); }} />}
      {/* Soft edges, then the fixed marker: ink line under a small halftone glow. */}
      <LinearGradient pointerEvents="none" colors={["rgba(255,255,255,0.96)", "rgba(255,255,255,0)"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 56 }} />
      <LinearGradient pointerEvents="none" colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.96)"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 56 }} />
      {width > 0 && <View pointerEvents="none" style={{ position: "absolute", top: 12, left: width / 2 - 12, width: 24, alignItems: "center" }}>
        <HalftoneGlint width={24} height={12} origin={[12, 12]} reach={[12, 11]} pitch={3} strength={0.9} />
        <View style={{ width: 2.5, height: 30, borderRadius: 1.25, backgroundColor: palette.ink }} />
      </View>}
    </View>
  </View>;
}

// After Superlist's inline task parsing: a suggestion pops from the text (spring 0.35 s, damping
// 0.72, items staggered 40 ms) and, once taken, the token it fills pops in (from 0.6, spring 0.38 s, damping 0.7).
const POP = { duration: 350, dampingRatio: 0.72 };
const TOKEN = { duration: 380, dampingRatio: 0.7 };
function popIn() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ translateY: -4 }, { scale: 0.92 }] },
    animations: { opacity: withTiming(1, { duration: 150 }), transform: [{ translateY: withSpring(0, POP) }, { scale: withSpring(1, POP) }] },
  };
}
function tokenIn() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.6 }] },
    animations: { opacity: withTiming(1, { duration: 160 }), transform: [{ scale: withSpring(1, TOKEN) }] },
  };
}
const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** Ink popover under the sentence offering what the typing implies. Nothing applies until tapped. */
function Suggestions({ children, reduced }: { children: ReactNode; reduced: boolean }) {
  return <Animated.View entering={reduced ? FadeIn.duration(120) : popIn} exiting={FadeOut.duration(120)}
    style={{ position: "absolute", top: "100%", right: 0, marginTop: 8, minWidth: 190, padding: 6, gap: 2, borderRadius: radius.group, borderCurve: "continuous", overflow: "hidden", backgroundColor: "rgba(29,31,35,0.95)", boxShadow: "0 12px 30px rgba(20,24,32,0.28)", transformOrigin: "top right" }}>
    <HalftoneGlint width={120} height={40} origin={[0, 0]} reach={[110, 36]} pitch={3} strength={0.5} tint={[0.62, 0.78, 1]} hueShift={0.6} style={{ top: 0, left: 0 }} />
    {children}
  </Animated.View>;
}
function SuggestionRow({ icon, label, index, onPress, reduced }: { icon: "person" | "calendar"; label: string; index: number; onPress: () => void; reduced: boolean }) {
  return <Animated.View entering={reduced ? undefined : riseIn({ delay: 40 * index, distance: 4, duration: 220 })}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={{ top: 2, bottom: 2 }}>{({ pressed }) => <PressScale pressed={pressed} style={{ minHeight: 40, paddingHorizontal: 10, borderRadius: radius.control, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: pressed ? "rgba(255,255,255,0.12)" : "transparent", transitionProperty: ["transform", "backgroundColor"] }}>
      <BrandIcon name={icon} size={16} color="rgba(255,255,255,0.8)" />
      <Text style={{ ...type.callout, fontWeight: "500", color: palette.white }}>{label}</Text>
    </PressScale>}</Pressable>
  </Animated.View>;
}

/**
 * One sentence and two quiet tokens (after Superlist): owner and due date. Tapping a token opens
 * its choices in place; picking one closes it. The round button commits.
 */
function Composer({ draft, onChange, onSave, pending, error }: { draft: TaskDraft; onChange: (update: Partial<TaskDraft>) => void; onSave: () => void; pending: boolean; error?: string }) {
  const { reducedMotion } = useAccessibleEffects();
  const [open, setOpen] = useState<"owner" | "due" | null>(null);
  const ready = taskDraftErrors(draft).length === 0 && !pending;
  const missing = [!draft.title.trim() && "a task", !draft.owner.trim() && "an owner", !draft.due && "a due date"].filter(Boolean) as string[];
  const toggle = (next: "owner" | "due") => { haptic("select"); setOpen(current => current === next ? null : next); };
  const set = (update: Partial<TaskDraft>) => onChange({ ...update, provenance: "clinician" });
  const layout = reducedMotion ? undefined : LAYOUT;
  // Typing "@nurse" or ending with "tomorrow" / "in 2 weeks" offers the owner or date inline.
  const mention = mentionQuery(draft.title);
  const parsed = mention === undefined ? parseDuePhrase(draft.title) : undefined;
  const q = mention?.toLowerCase() ?? "";
  const ownerMatches = mention === undefined ? [] : OWNERS.filter(owner => !q || owner.toLowerCase().split(" ").some(word => word.startsWith(q)));
  const customMatch = q && !ownerMatches.length ? capitalise(mention!) : undefined;
  const takeOwner = (owner: string) => { haptic("select"); setOpen(null); set({ owner, title: draft.title.replace(/\s*@[^\s@]*$/, "") }); };
  const takeDue = () => { if (!parsed) return; haptic("select"); setOpen(null); const at = draft.title.toLowerCase().lastIndexOf(parsed.phrase.toLowerCase()); set({ due: parsed.due, title: draft.title.slice(0, at).trimEnd() }); };
  const typed = mention !== undefined ? `@${mention}` : parsed?.phrase;
  const head = typed ? draft.title.slice(0, draft.title.toLowerCase().lastIndexOf(typed.toLowerCase())) : draft.title;
  const tokenIcon = (name: "person" | "calendar", filled: boolean) => <BrandIcon name={name} size={17} color={filled ? palette.blue : palette.muted} />;
  return <Surface feature layout={layout} style={{ padding: 18, gap: 16 }}>
    <View style={{ zIndex: 2 }}>
      {/* The phrase being read is tinted blue in place (children instead of value keep the caret). */}
      <TextInput accessibilityLabel="Task" onChangeText={title => set({ title })} placeholder={'Try “Bloods @nurse in 2 weeks”'} placeholderTextColor={palette.placeholder} multiline maxLength={240} editable={!pending}
        style={{ ...type.heading, fontWeight: "500", color: palette.ink, padding: 0 }}>
        {typed ? <>{head}<RNText style={{ color: palette.blue }}>{draft.title.slice(head.length)}</RNText></> : draft.title}
      </TextInput>
      {(ownerMatches.length > 0 || customMatch) && <Suggestions key="owner" reduced={reducedMotion}>
        {ownerMatches.slice(0, 4).map((owner, i) => <SuggestionRow key={owner} icon="person" label={owner} index={i} reduced={reducedMotion} onPress={() => takeOwner(owner)} />)}
        {customMatch && <SuggestionRow icon="person" label={`Assign ${customMatch}`} index={Math.min(ownerMatches.length, 4)} reduced={reducedMotion} onPress={() => takeOwner(customMatch)} />}
      </Suggestions>}
      {parsed && <Suggestions key={`due-${parsed.due}`} reduced={reducedMotion}>
        <SuggestionRow icon="calendar" label={`Due ${friendlyDate(parsed.due)}`} index={0} reduced={reducedMotion} onPress={takeDue} />
      </Suggestions>}
    </View>
    {/* Chips keep clear of the add button, which always sits in the card's bottom-right corner. */}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingRight: 52 }}>
        <Animated.View key={draft.owner ? `owner-${draft.owner}` : "owner"} layout={layout} entering={draft.owner && !reducedMotion ? tokenIn : undefined}><Chip icon={tokenIcon("person", Boolean(draft.owner))} label={draft.owner || "Owner"} filled={Boolean(draft.owner)} expanded={open === "owner"} onPress={() => toggle("owner")} accessibilityLabel={draft.owner ? `Owner, ${draft.owner}. Change` : "Choose an owner"} /></Animated.View>
        <Animated.View key={draft.due ? `due-${draft.due}` : "due"} layout={layout} entering={draft.due && !reducedMotion ? tokenIn : undefined}><Chip icon={tokenIcon("calendar", Boolean(draft.due))} label={friendlyDate(draft.due) || "Due"} filled={Boolean(draft.due)} expanded={open === "due"} onPress={() => toggle("due")} accessibilityLabel={draft.due ? `Due ${friendlyDate(draft.due)}. Change` : "Choose a due date"} /></Animated.View>
    </View>

    {open === "owner" && <Expand key="owner"><OwnerPicker value={draft.owner} onChange={owner => set({ owner })} onDone={() => setOpen(null)} /></Expand>}

    {open === "due" && <Expand key="due"><DayRuler value={draft.due} onPick={due => set({ due })} /></Expand>}

    {/* With a panel open (or an error), a footer row keeps the corner free below it. */}
    {(open || error) && <Animated.View layout={layout} entering={FadeIn.duration(150)} style={{ minHeight: 40, justifyContent: "center", paddingRight: 52 }}>
      {error && <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.amber }}>{error}</Text>}
    </Animated.View>}
    <Animated.View layout={layout} style={{ position: "absolute", right: 18, bottom: 18, zIndex: 1 }}>
      <RoundAction icon="add" size={40} label={error ? "Retry adding task" : "Add task"} hint={missing.length ? `Needs ${missing.join(", ")}` : undefined} ready={ready} onPress={onSave} />
    </Animated.View>
  </Surface>;
}

/**
 * The owner list the composer and each task row share: the usual owners, or someone else by name.
 * `onChange` follows every pick and keystroke (tapping the chosen owner again clears it); `onDone`
 * fires once a choice is final (a chip picked, or return pressed on a typed name).
 */
function OwnerPicker({ value, onChange, onDone }: { value: string; onChange: (owner: string) => void; onDone: () => void }) {
  const [custom, setCustom] = useState(Boolean(value) && !OWNERS.includes(value));
  return <View style={{ gap: 10 }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {OWNERS.map(owner => <Chip key={owner} label={owner} selected={value === owner} onPress={() => { haptic("select"); setCustom(false); if (value === owner) onChange(""); else { onChange(owner); onDone(); } }} />)}
      <Chip label="Someone else" selected={custom} onPress={() => { haptic("select"); if (custom) { setCustom(false); onChange(""); return; } setCustom(true); if (OWNERS.includes(value)) onChange(""); }} />
    </View>
    {custom && <Expand><TextInput autoFocus accessibilityLabel="Owner name or team" value={value} onChangeText={onChange} placeholder="Name or team" placeholderTextColor={palette.placeholder} maxLength={80} returnKeyType="done" onSubmitEditing={onDone}
      style={{ fontSize: type.body.fontSize, color: palette.ink, paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, borderRadius: radius.control, backgroundColor: "rgba(20,28,40,0.04)" }} /></Expand>}
  </View>;
}

type Receipt = { text: string; failed?: boolean };
type TaskChange = { owner?: string; due?: string };

/**
 * Completing, reopening, reassigning and redating tasks, for any visit: server tasks through the API
 * (the server keeps no reopen), device tasks in their visit's store. Each change leaves a receipt on
 * its row. What this role can't do comes back locked (`locked`) or absent (`change`).
 */
function useTaskEdits() {
  const updateEncounter = useEncounterSelect(s => s.updateEncounter);
  const server = useServerData();
  const role = useRole();
  const [receipts, setReceipts] = useState<Record<string, Receipt>>({});
  const onServer = (task: Task) => Boolean(server?.tasks.some(value => value.id === task.id));
  const note = (id: string, receipt: Receipt) => setReceipts(r => ({ ...r, [id]: receipt }));
  const edit = (patientId: string, id: string, change: Partial<Task>) => updateEncounter(current => ({ ...current, tasks: current.tasks.map(value => value.id === id ? { ...value, ...change } : value) }), false, patientId);
  const toggle = (patientId: string, task: Task) => {
    if (!onServer(task)) edit(patientId, task.id, { completed: !task.completed });
    else if (!task.completed) completeServerTask(task.id).catch(e => note(task.id, { text: `Not completed: ${errorText(e)}`, failed: true }));
  };
  const change = (patientId: string, task: Task, update: TaskChange) => {
    const saved = () => note(task.id, { text: changeReceipt(update, new Date()) });
    if (!onServer(task)) { edit(patientId, task.id, update); saved(); return; }
    api.tasks.update({ taskId: task.id, ...update }).then(refreshServerData).then(saved, e => note(task.id, { text: `Not saved: ${errorText(e)}`, failed: true }));
  };
  return { receipts, toggle, change: role.can("tasks.update") ? change : undefined, locked: !role.can("tasks.complete"), why: role.why, reopenable: (task: Task) => !onServer(task) };
}

/**
 * Check marker morphs into a tick and a strike draws across; swipe right does the same. With
 * `onChange`, the owner and due chips open the composer's owner list and day ruler under the row, and
 * the receipt says what changed. `locked`: this role can't complete tasks (a lock where the tick goes).
 * `reopenable`: a completed task can be reopened (device tasks only), else tapping it does nothing.
 * `patient`/`name`: the visit it belongs to, when the list spans visits.
 */
function TaskRow({ task, patient: of, name, disabled, locked = false, reopenable = true, receipt, onToggle, onChange }: {
  task: Task; patient?: Patient; name?: string; disabled: boolean; locked?: boolean; reopenable?: boolean; receipt?: Receipt; onToggle: () => void; onChange?: (change: TaskChange) => void;
}) {
  const { reducedMotion } = useAccessibleEffects();
  const current = useEncounterSelect(s => s.patient);
  const { why } = useRole();
  const patient = of ?? current;
  const [completing, setCompleting] = useState(false);
  const [editing, setEditing] = useState<"owner" | "due" | null>(null);
  const [ownerDraft, setOwnerDraft] = useState(task.owner);
  const picked = useRef(task.owner);
  useEffect(() => { if (!task.completed) setCompleting(false); }, [task.completed]);
  const done = task.completed || completing;
  // Locked, or done on the server (which keeps no reopen): the row reads but doesn't toggle.
  const inert = disabled || locked || (task.completed && !reopenable);
  const editable = Boolean(onChange) && !task.completed && !locked;
  const toggle = () => {
    if (inert) return;
    if (task.completed) { haptic("select"); onToggle(); return; }
    setEditing(null);
    setCompleting(true); haptic("done");
    // Let the tick and strike land before the row moves to Completed.
    setTimeout(onToggle, reducedMotion ? 0 : 420);
  };
  const source = task.sourceSnapshot ?? patient?.sources.find(item => item.id === task.sourceId);
  const openSource = () => source && patient && router.push({ pathname: "/source", params: { id: source.id, patientId: patient.id, revision: String(task.sourceRevision ?? ""), taskId: task.id } });
  const tx = useSharedValue(0);
  // The reveal names what this swipe will do, fixed when the swipe starts so it can't flip mid-gesture.
  const [reopens, setReopens] = useState(task.completed);
  const wasCompleted = task.completed;
  const pan = Gesture.Pan().activeOffsetX(14).failOffsetY([-12, 12]).enabled(!inert)
    .onStart(() => scheduleOnRN(setReopens, wasCompleted))
    .onUpdate(e => { const x = Math.max(0, e.translationX); tx.set(x > SWIPE ? SWIPE + (x - SWIPE) * 0.35 : x); })
    .onEnd(e => {
      const commit = tx.value >= SWIPE || e.velocityX > 800;
      tx.set(withSpring(0, { duration: 380, dampingRatio: 0.85, velocity: e.velocityX }));
      if (commit) scheduleOnRN(toggle);
    });
  useAnimatedReaction(() => tx.value >= SWIPE, (over, was) => { if (over && was === false) scheduleOnRN(haptic, "select"); });
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const revealStyle = useAnimatedStyle(() => ({ opacity: interpolate(tx.value, [0, SWIPE], [0, 1], "clamp"), transform: [{ scale: interpolate(tx.value, [0, SWIPE], [0.8, 1], "clamp") }] }));
  const edit = (kind: "owner" | "due") => { haptic("select"); if (kind === "owner") { picked.current = task.owner; setOwnerDraft(task.owner); } setEditing(value => value === kind ? null : kind); };
  const dueLabel = task.due ? friendlyDate(task.due) : "No date";
  const chip = (kind: "owner" | "due", label: string) => <Pressable accessibilityRole="button" accessibilityLabel={kind === "owner" ? `Owner, ${label}. Reassign` : `Due ${label}. Change date`} accessibilityState={{ expanded: editing === kind }} onPress={() => edit(kind)} hitSlop={{ top: 8, bottom: 8 }}>{({ pressed }) => <PressScale pressed={pressed} style={{ height: 28, paddingHorizontal: 10, borderRadius: 14, flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: editing === kind ? palette.blue : "transparent", backgroundColor: "rgba(20,28,40,0.05)" }}>
    <BrandIcon name={kind === "owner" ? "person" : "calendar"} size={13} color={palette.muted} /><Text style={{ ...type.footnote, color: palette.ink }}>{label}</Text>
  </PressScale>}</Pressable>;
  const actions = [...source ? [{ name: "source", label: "Open source" }] : [], ...editable ? [{ name: "owner", label: "Reassign" }, { name: "due", label: "Change due date" }] : []];
  return <View>
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, bottom: 0, width: 120, borderRadius: radius.group, backgroundColor: "#E4EDFD", paddingLeft: 22, justifyContent: "center" }, revealStyle]}>
      <BrandIcon name={reopens ? "back" : "check"} size={22} color={palette.blue} strokeWidth={2} />
    </Animated.View>
    <GestureDetector gesture={pan}>
      <Surface style={[{ borderRadius: radius.group }, rowStyle]}>
        {/* The whole row is the checkbox; only the Source link inside it does something else. */}
        <Pressable accessibilityRole="checkbox" accessibilityLabel={`${name ? `${name}, ` : ""}${task.title}, ${task.owner}${done ? ", done" : task.due ? `, due ${friendlyDate(task.due)}` : ""}`} accessibilityState={{ checked: done, disabled: inert }}
          accessibilityHint={locked ? why("tasks.complete") : inert ? undefined : done ? "Reopens the task" : "Marks the task completed"} onPress={toggle} disabled={inert}
          accessibilityActions={actions.length ? [{ name: "activate" }, ...actions] : undefined} onAccessibilityAction={e => { const a = e.nativeEvent.actionName; if (a === "source") openSource(); else if (a === "owner" || a === "due") edit(a); else toggle(); }}>{({ pressed }) => <PressScale pressed={pressed} scale={0.98} style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 14 }}>
          {locked && !done ? <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(20,28,40,0.06)" }}><Icon name="lock.fill" size={11} color={palette.muted} /></View>
          : <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1.6, alignItems: "center", justifyContent: "center", borderColor: done ? palette.blue : "#B7BDC6", backgroundColor: done ? palette.blue : "transparent", transitionProperty: ["backgroundColor", "borderColor"], transitionDuration: 180 } as never}>
            <Animated.View style={{ opacity: done ? 1 : 0, transform: [{ scale: done || reducedMotion ? 1 : 0.5 }], transitionProperty: ["opacity", "transform"], transitionDuration: 240, transitionTimingFunction: EASE_OUT }}>
              <BrandIcon name="check" size={15} color={palette.white} strokeWidth={2.4} />
            </Animated.View>
          </Animated.View>}
          <View style={{ flex: 1, gap: 3 }}>
            <View style={{ alignSelf: "flex-start" }}>
              <Animated.Text lineBreakStrategyIOS="push-out" style={{ ...type.body, lineHeight: 22, fontWeight: "500", color: done ? palette.muted : palette.ink, transitionProperty: "color", transitionDuration: 200 } as never}>{task.title}</Animated.Text>
              <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 11, height: 1.5, borderRadius: 1, backgroundColor: palette.muted, transformOrigin: "left", opacity: done || !reducedMotion ? 1 : 0, transform: [{ scaleX: done || reducedMotion ? 1 : 0 }], transitionProperty: ["transform", "opacity"], transitionDuration: 320, transitionTimingFunction: EASE_OUT }} />
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: editable ? 6 : 8 }}>
              {name && <Text style={{ ...type.footnote, fontWeight: "600", color: palette.ink }}>{name}</Text>}
              {/* Owner and due read as chips on an open task this role may change; tapping one opens its picker under the row. */}
              {editable ? <>{chip("owner", task.owner)}{chip("due", dueLabel)}</> : <Text style={{ ...type.footnote, color: palette.muted }}>{ownerLine(task, done)}</Text>}
              {source && <Pressable accessibilityRole="link" accessibilityLabel={`Source, ${source.title}`} onPress={openSource} hitSlop={{ top: 13, bottom: 13, left: 8, right: 8 }}><Text style={{ ...type.footnote, color: palette.blue }}>Source ↗</Text></Pressable>}
            </View>
          </View>
        </PressScale>}</Pressable>
      </Surface>
    </GestureDetector>
    {/* The composer's own pickers, under the row (outside the swipe, so the ruler scrolls freely). */}
    {editing && editable && <Expand key={editing} style={{ marginTop: 6 }}><Surface style={{ padding: 18 }}>
      {editing === "owner" ? <OwnerPicker value={ownerDraft} onChange={owner => { picked.current = owner; setOwnerDraft(owner); }} onDone={() => { setEditing(null); const owner = picked.current.trim(); if (owner && owner !== task.owner) onChange!({ owner }); }} />
        : <DayRuler value={/^\d{4}-\d{2}-\d{2}$/.test(task.due) ? task.due : ""} onPick={due => onChange!({ due })} />}
    </Surface></Expand>}
    {receipt && <Animated.Text key={receipt.text} entering={reducedMotion ? undefined : FadeIn.duration(180)} accessibilityLiveRegion="polite"
      style={{ ...type.caption, color: receipt.failed ? palette.amber : palette.green, paddingHorizontal: 16, paddingTop: 6 }}>{receipt.text}</Animated.Text>}
  </View>;
}

/** Open rows by when they're due (overdue first, so the next one to chase leads), then Completed: one keyed list, so a completed row glides into Completed instead of remounting there. */
function rankedList<T extends { task: Task }>(rows: T[], render: (row: T) => ReactNode) {
  const done = rows.filter(row => row.task.completed);
  return [
    ...rankByDue(rows).flatMap(g => [<Section key={g.id} title={g.title} count={g.rows.length} />, ...g.rows.map(render)]),
    done.length > 0 && <Section key="done" title="Completed" count={done.length} />,
    ...done.map(render),
  ];
}

function Section({ title, count }: { title: string; count: number }) {
  const { reducedMotion } = useAccessibleEffects();
  return <Animated.View layout={reducedMotion ? undefined : LAYOUT} accessible accessibilityRole="header" accessibilityLabel={`${title}, ${count}`} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 10, paddingHorizontal: 4 }}>
    <Text style={{ ...type.callout, fontWeight: "600", color: palette.ink }}>{title}</Text>
    <View style={{ minWidth: 24, height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: "rgba(20,28,40,0.06)", alignItems: "center", justifyContent: "center" }}>
      <Animated.Text key={count} entering={reducedMotion ? FadeIn.duration(150) : riseIn({ distance: 6, scale: 0.9, duration: 220 })} style={{ ...type.caption, fontWeight: "600", color: palette.muted, fontVariant: ["tabular-nums"] }}>{count}</Animated.Text>
    </View>
  </Animated.View>;
}

/** One card per visit with follow-ups: open count and the next few, tap to work on that visit. */
function VisitFollowUps({ except }: { except?: string }) {
  const patients = useEncounterSelect(s => s.patients), selectPatient = useEncounterSelect(s => s.selectPatient);
  const tasksOf = useVisitTasks();
  return <>{patients.filter(p => p.id !== except && tasksOf(p).length).map(p => {
    const pending = tasksOf(p).filter(task => !task.completed);
    return <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`${p.name}, ${pending.length} open follow-ups`} accessibilityHint="Shows this visit's follow-ups" onPress={() => { haptic("select"); selectPatient(p.id); }}>{({ pressed }) => <PressScale pressed={pressed} scale={0.98}>
      <Surface style={{ padding: 16, gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#E6EEFC", alignItems: "center", justifyContent: "center" }}><Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>{p.initials}</Text></View>
          <Text style={{ flex: 1, ...type.body, fontWeight: "600", color: palette.ink }}>{p.name}</Text>
          <Text style={{ ...type.footnote, color: palette.muted, fontVariant: ["tabular-nums"] }}>{pending.length ? `${pending.length} open` : "All done"}</Text>
          <View accessibilityElementsHidden style={{ transform: [{ rotate: "180deg" }] }}><BrandIcon name="back" size={16} color={palette.muted} strokeWidth={1.8} /></View>
        </View>
        {pending.slice(0, 3).map(task => <Text key={task.id} numberOfLines={1} style={{ ...type.subhead, color: palette.ink }}>{task.title}<Text style={{ color: palette.muted }}>  {ownerLine(task)}</Text></Text>)}
      </Surface>
    </PressScale>}</Pressable>;
  })}</>;
}

/** The page's one-line answer: open, overdue (amber) and due today, zero parts left out. */
function TasksInsight({ tasks, eyebrow }: { tasks: Task[]; eyebrow?: string }) {
  const { open, overdue, dueToday } = taskCounts(tasks);
  const parts = [`${open} open`, overdue ? <Tone key="overdue" of="soon">{overdue} overdue</Tone> : null, dueToday ? `${dueToday} due today` : null].filter(Boolean);
  return <Insight eyebrow={eyebrow}>{open ? parts.map((part, i) => [i ? " · " : "", part]) : tasks.length ? "All follow-ups done" : "No follow-ups yet"}</Insight>;
}

/** A role that can't complete tasks reads them: one line says why, where the ticks would be. */
function LockedNote({ edits }: { edits: ReturnType<typeof useTaskEdits> }) {
  return edits.locked ? <Notice>Read only. {edits.why("tasks.complete")}</Notice> : null;
}

/**
 * No visit selected: every follow-up across today's visits in one list ranked by when it's due
 * (not by patient), each completable and changeable in place, and a one-tap way to add one for a visit.
 */
function AllFollowUps() {
  const patients = useEncounterSelect(s => s.patients), selectPatient = useEncounterSelect(s => s.selectPatient);
  const { reducedMotion } = useAccessibleEffects();
  const tasksOf = useVisitTasks();
  const edits = useTaskEdits();
  const { can } = useRole();
  const rows = patients.flatMap(patient => tasksOf(patient).map(task => ({ task, patient })));
  const row = ({ task, patient }: { task: Task; patient: Patient }) => <Animated.View key={task.id} layout={reducedMotion ? undefined : LAYOUT} entering={reducedMotion ? undefined : riseIn({ distance: 10, duration: 320 })} exiting={FadeOut.duration(140)}>
    <TaskRow task={task} patient={patient} name={patient.name} disabled={false} locked={edits.locked} reopenable={edits.reopenable(task)} receipt={edits.receipts[task.id]}
      onToggle={() => edits.toggle(patient.id, task)} onChange={edits.change && (change => edits.change!(patient.id, task, change))} />
  </Animated.View>;
  return <TasksSona><Screen>
    <TasksInsight tasks={rows.map(r => r.task)} />
    <LockedNote edits={edits} />
    {rankedList(rows, row)}
    {can("tasks.create") && <View style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={{ ...type.footnote, fontWeight: "600", color: palette.muted, paddingHorizontal: 4 }}>Add a follow-up for</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {patients.map(p => <Chip key={p.id} label={p.name} onPress={() => { haptic("select"); selectPatient(p.id); }} accessibilityLabel={`Add a follow-up for ${p.name}`} />)}
      </View>
    </View>}
    <SessionNote />
    <View style={{ height: ASK_SPACE }} />
  </Screen></TasksSona>;
}

/** Tasks in the Sona dock: what's overdue across today's visits, with the most overdue one to mark done after a review. */
function TasksSona({ children }: { children: ReactNode }) {
  const patients = useEncounterSelect(s => s.patients);
  const tasksOf = useVisitTasks();
  const { on: live } = useLive();
  const lines = patients.flatMap(p => tasksOf(p).filter(t => !t.completed).map(t => ({ id: t.id, patientId: p.id, patientName: p.name, title: t.title, owner: t.owner, due: t.due, group: dueGroup(t.due) })));
  return <WithSona scope="tasks" answers={[overdue(lines, !live)]}>{children}</WithSona>;
}

export function TasksScreen() {
  const { patient, patients, encounter, updateEncounter, simulateFailure } = useEncounterSelect(s => ({ patient: s.patient, patients: s.patients, encounter: s.encounter, updateEncounter: s.updateEncounter, simulateFailure: s.simulateFailure }), sameShallow);
  const { reducedMotion } = useAccessibleEffects();
  const tasksOf = useVisitTasks();
  const edits = useTaskEdits();
  const { can } = useRole();
  const { on: live } = useLive();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // One request ID per draft, so a retry after a lost reply returns the saved task instead of adding another.
  const serverRequest = useRef<{ operationId: string; requestId: string }>(undefined);
  const activePatient = useRef(patient?.id);
  useEffect(() => { activePatient.current = patient?.id; }, [patient?.id]);
  useEffect(() => { if (error) AccessibilityInfo.announceForAccessibility(error); }, [error]);
  useEffect(() => {
    if (!patient || !encounter || encounter.taskDraft) return;
    const draft: TaskDraft = { operationId: `task-${patient.encounterId}-${Date.now()}`, owner: "", due: "", ...taskProposal(encounter, patient) };
    updateEncounter(current => current.taskDraft ? current : { ...current, taskDraft: draft });
  }, [patient, encounter, updateEncounter]);
  useEffect(() => { setError(undefined); setPending(false); pendingRef.current = false; return () => { if (saveTimer.current) clearTimeout(saveTimer.current); }; }, [patient?.id]);
  if (!patient || !encounter) return <AllFollowUps />;
  const draft = encounter.taskDraft;
  const saveLocally = (apply: () => void) => {
    if (pendingRef.current) return;
    const patientId = patient.id;
    pendingRef.current = true; setPending(true); setError(undefined);
    // Fixture transport exposes pending/retry states without a backend request.
    saveTimer.current = setTimeout(() => {
      if (activePatient.current !== patientId) return;
      if (simulateFailure) setError("Save failed. Your draft is kept; retry keeps the same task.");
      else apply();
      pendingRef.current = false; setPending(false);
    }, 320);
  };
  // Creating hands the composer a fresh blank draft, so the next step can be typed straight away.
  const blankDraft = (next: Encounter): TaskDraft => ({ ...taskProposal(next, patient), operationId: `task-${patient.encounterId}-${Date.now()}`, title: "", owner: "", due: "", provenance: "clinician" });
  const added = () => { haptic("done"); AccessibilityInfo.announceForAccessibility("Task added"); };
  // Live mode: the server keeps the task and the list shows it from there; a refusal keeps the draft.
  const saveToServer = async (draft: TaskDraft) => {
    if (pendingRef.current) return;
    const patientId = patient.id;
    pendingRef.current = true; setPending(true); setError(undefined);
    if (serverRequest.current?.operationId !== draft.operationId) serverRequest.current = { operationId: draft.operationId, requestId: requestId() };
    try {
      await createServerTask({ encounterId: patient.encounterId, title: draft.title, owner: draft.owner, due: draft.due, requestId: serverRequest.current.requestId });
      if (activePatient.current !== patientId) return;
      added();
      updateEncounter(current => ({ ...current, taskDraft: blankDraft(current) }));
    } catch (e) {
      if (activePatient.current === patientId) setError(errorText(e));
    } finally {
      if (activePatient.current === patientId) { pendingRef.current = false; setPending(false); }
    }
  };
  const save = () => {
    if (!draft || taskDraftErrors(draft).length) return;
    if (live) return void saveToServer(draft);
    saveLocally(() => { added(); updateEncounter(current => {
      const next = createTaskOnce(current, draft);
      if (next === current) return current;
      return { ...next, taskDraft: blankDraft(next) };
    }); });
  };
  const tasks = tasksOf(patient);
  const row = ({ task }: { task: Task }) => <Animated.View key={task.id} layout={reducedMotion ? undefined : LAYOUT} entering={reducedMotion ? undefined : riseIn({ distance: 10, duration: 320 })} exiting={FadeOut.duration(140)}>
    <TaskRow task={task} disabled={pending} locked={edits.locked} reopenable={edits.reopenable(task)} receipt={edits.receipts[task.id]}
      onToggle={() => edits.toggle(patient.id, task)} onChange={edits.change && (change => edits.change!(patient.id, task, change))} />
  </Animated.View>;

  return <TasksSona><Screen>
    <TasksInsight tasks={tasks} eyebrow={patient.name} />
    {/* A role that can't add tasks keeps the composer's place, locked, and says who can on tap. */}
    {!can("tasks.create") ? <LockedAction label="Needs a doctor or a nurse to add a task" path="tasks.create" />
      : draft && <Composer key={draft.operationId} draft={draft} pending={pending} error={error} onChange={change => updateEncounter(current => ({ ...current, taskDraft: { ...current.taskDraft!, ...change } }))} onSave={save} />}
    <LockedNote edits={edits} />
    {rankedList(tasks.map(task => ({ task })), row)}
    {patients.some(p => p.id !== patient.id && tasksOf(p).length) && <Text accessibilityRole="header" style={{ ...type.callout, fontWeight: "600", color: palette.ink, paddingTop: 10, paddingHorizontal: 4 }}>Other visits</Text>}
    <VisitFollowUps except={patient.id} />
    <SessionNote />
    <View style={{ height: ASK_SPACE }} />
  </Screen></TasksSona>;
}
