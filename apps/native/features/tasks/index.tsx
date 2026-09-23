import { Text } from "@/components/sona/text";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, Text as RNText, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cubicBezier, FadeIn, FadeOut, interpolate, withTiming, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { scheduleOnRN } from "react-native-worklets";
import { BrandIcon } from "@/components/sona/brand-icon";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { Action, Body, Card, Chip, Expand, Notice, RoundAction, Screen, SourceLink, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { HalftoneGlint } from "@/components/sona/halftone-shimmer";
import { palette } from "@/components/sona/theme";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps, Task } from "@/features/encounter/types";
import { createTaskOnce, localDate, mentionQuery, parseDuePhrase, proposedTask, readableDate, taskDraftErrors, taskProposal, type TaskDraft } from "./state";

export function FollowupCard({ patient, onOpen, onSource }: FeatureProps) {
  const { encounter } = useEncounter();
  const created = encounter?.tasks ?? [];
  const proposal = encounter?.taskDraft ?? (encounter ? taskProposal(encounter, patient) : undefined);
  return <Card feature label="Follow-up · local simulation" title={created.length ? "Keep the next step in sight" : "A clear next step"} footer={created.length ? undefined : proposal ? <TaskOrigin value={proposal} /> : <SourceLink label="Encounter context" onPress={() => onSource("history")} />}>
    {created.length ? <><Body>{created.filter(task => !task.completed).length} open · {created.filter(task => task.completed).length} completed</Body>{created.slice(-2).map(task => <TaskSummary key={task.id} task={task} />)}</> : <><Body>{proposal?.title ?? proposedTask}</Body><View style={{ gap: 8 }}><Detail label="Patient" value={`${patient.name} · ${patient.id}`} /><Detail label="Owner" value="Needs assignment" /><Detail label="Due" value="Needs a date" /></View><Notice>{proposal?.sourceId === "clinical-note" ? "Proposed from the clinician-entered plan in this synthetic encounter. Set the owner and date before creating it." : "Authored synthetic proposal from the encounter context. Set the details before creating it."}</Notice></>}
    <Action label={created.length ? "Manage follow-up" : "Set task details"} icon="calendar.badge.plus" onPress={() => onOpen("tasks")} />
  </Card>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <View style={{ flexDirection: "row", alignItems: "baseline", gap: 14 }}><Text style={{ fontSize: 13, color: palette.muted, minWidth: 58 }}>{label}</Text><Text selectable style={{ color: palette.ink, fontSize: 14, lineHeight: 21, flex: 1 }}>{value}</Text></View>;
}
function TaskSummary({ task }: { task: Task }) {
  return <View style={{ padding: 14, backgroundColor: task.completed ? "#E9F1ED" : "#EAF0F9", borderRadius: 16, gap: 6 }}><Text selectable style={{ color: palette.ink, fontSize: 16, fontWeight: "500" }}>{task.title}</Text><Text selectable style={{ color: palette.muted, fontSize: 13, lineHeight: 20 }}>{task.owner} · {readableDate(task.due)} · {task.completed ? "Completed" : "Open"}</Text><TaskOrigin value={task} /></View>;
}

function TaskOrigin({ value }: { value: Pick<Task, "sourceId" | "sourceRevision" | "provenance" | "sourceSnapshot"> & { id?: string; operationId?: string } }) {
  const { patient } = useEncounter();
  const source = value.sourceSnapshot ?? patient?.sources.find(item => item.id === value.sourceId);
  return <View style={{ gap: 5 }}><Text selectable style={{ color: palette.muted, fontSize: 12, lineHeight: 18 }}>{value.provenance === "clinician" ? "Clinician-entered details · synthetic encounter" : value.provenance === "fixture" ? "Authored synthetic proposal" : "Origin not recorded"}</Text>{source && patient ? <SourceLink label={`${source.title}${value.sourceRevision ? ` · revision ${value.sourceRevision}` : ""}`} onPress={() => router.push({ pathname: "/source", params: { id: source.id, patientId: patient.id, revision: String(value.sourceRevision ?? ""), taskId: value.id ?? value.operationId ?? "" } })} /> : <Text selectable style={{ color: palette.muted, fontSize: 12 }}>No originating source linked</Text>}</View>;
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
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function haptic(kind: "select" | "done") {
  if (process.env.EXPO_OS !== "ios") return;
  (kind === "done" ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : Haptics.selectionAsync()).catch(() => {});
}
function dayFromToday(days: number) { const t = new Date(); return localDate(new Date(t.getFullYear(), t.getMonth(), t.getDate() + days)); }
/** "Thu 3 Sep", with the year once it is not this year ("Fri 13 Oct 2028"). */
function longDate(due: string) { const d = new Date(`${due}T12:00:00`); return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === new Date().getFullYear() ? "" : ` ${d.getFullYear()}`}`; }
/** "Today", "Tomorrow", else the long date. */
function friendlyDate(due: string) {
  if (!due) return "";
  if (due === dayFromToday(0)) return "Today";
  if (due === dayFromToday(1)) return "Tomorrow";
  return longDate(due);
}

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
 * marker. Drag with momentum; it snaps to a day, ticks a haptic per day passed, and commits when
 * it settles. Months and years are labelled above, review intervals and yearly anniversaries
 * below (tap to jump), and the native compact picker jumps straight to any future date. The
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
  const latest = useRef({ value, onPick }); latest.current = { value, onPick };
  const commit = (i: number) => { const due = days[i]; if (due && due !== latest.current.value) latest.current.onPick(due); };
  const onScroll = useAnimatedScrollHandler({
    onScroll: e => { x.set(e.contentOffset.x); },
    onEndDrag: e => { if (Math.abs(e.velocity?.x ?? 0) < 0.05) scheduleOnRN(commit, clampDay(e.contentOffset.x / TICK)); },
    onMomentumEnd: e => { scheduleOnRN(commit, clampDay(e.contentOffset.x / TICK)); },
  });
  const jump = (i: number, animated = !reducedMotion) => {
    const day = clampDay(i);
    // A date beyond what is loaded: load up to it (and a year past), then jump once it has rendered.
    if (day >= days.length) { pendingJump.current = day; setCount(day + YEAR_OF_DAYS); return; }
    ref.current?.scrollToOffset({ offset: day * TICK, animated }); setShown(day); commit(day);
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
      {first && <Text numberOfLines={1} style={{ position: "absolute", top: 0, width: 60, left: (TICK - 60) / 2, textAlign: "center", fontSize: 10, fontWeight: "600", color: d.getMonth() === 0 ? palette.ink : palette.muted }}>{d.getMonth() === 0 ? String(d.getFullYear()) : MONTHS[d.getMonth()]}</Text>}
      <View style={{ marginTop: label || first ? 16 : week ? 21 : 25, width: 1.5, height: label || first ? 26 : week ? 21 : 17, borderRadius: 1, backgroundColor: label || first ? "rgba(20,28,40,0.32)" : week ? "rgba(20,28,40,0.2)" : "rgba(20,28,40,0.11)" }} />
      {label && <Pressable accessible={false} hitSlop={10} onPress={() => jumpRef.current(i)} style={{ position: "absolute", top: 54, width: 44, left: (TICK - 44) / 2, alignItems: "center" }}>
        <Text style={{ fontSize: 11, fontWeight: "500", color: palette.muted }}>{label}</Text>
      </Pressable>}
    </View>;
  }, []);
  const pickerDate = new Date(`${days[shown]}T12:00:00`);
  return <View accessible accessibilityRole="adjustable" accessibilityLabel="Due date" accessibilityValue={{ text: `${longDate(days[shown]!)}, ${relativeDay(shown)}` }}
    accessibilityActions={[{ name: "increment" }, { name: "decrement" }]} onAccessibilityAction={e => jump(shown + (e.nativeEvent.actionName === "increment" ? 1 : -1))} style={{ gap: 8 }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 20, fontWeight: "600", letterSpacing: -0.3, color: unset ? palette.muted : palette.ink, fontVariant: ["tabular-nums"] }}>{longDate(days[shown]!)}</Text>
        <Text style={{ fontSize: 13, color: palette.muted, fontVariant: ["tabular-nums"] }}>{unset ? "Slide, tap an interval, or pick a date" : relativeDay(shown)}</Text>
      </View>
      {/* Native compact picker: its calendar popover reaches any month or year in a couple of taps. */}
      <DateTimePicker style={{ width: 124 }} value={pickerDate} mode="date" display="compact" minimumDate={new Date(`${days[0]}T00:00:00`)} themeVariant="light" accentColor={palette.blue}
        onValueChange={(_, date) => jump(dayIndex(localDate(date)), false)} />
    </View>
    <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ height: 74, marginHorizontal: -18 }}>
      {width > 0 && <Animated.FlatList ref={ref} horizontal data={days} keyExtractor={day => day} renderItem={renderTick}
        getItemLayout={(_, i) => ({ length: TICK, offset: side + TICK * i, index: i })} ListHeaderComponent={<View style={{ width: side }} />} ListFooterComponent={<View style={{ width: side }} />}
        initialNumToRender={80} maxToRenderPerBatch={80} windowSize={7} onEndReachedThreshold={6} onEndReached={() => setCount(value => value + YEAR_OF_DAYS)} onScroll={onScroll} scrollEventThrottle={16} showsHorizontalScrollIndicator={false} snapToInterval={TICK} decelerationRate="fast"
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
    style={{ position: "absolute", top: "100%", right: 0, marginTop: 8, minWidth: 190, padding: 6, gap: 2, borderRadius: 18, borderCurve: "continuous", overflow: "hidden", backgroundColor: "rgba(29,31,35,0.95)", boxShadow: "0 12px 30px rgba(20,24,32,0.28)", transformOrigin: "top right" }}>
    <HalftoneGlint width={120} height={40} origin={[0, 0]} reach={[110, 36]} pitch={3} strength={0.5} tint={[0.62, 0.78, 1]} hueShift={0.6} style={{ top: 0, left: 0 }} />
    {children}
  </Animated.View>;
}
function SuggestionRow({ icon, label, index, onPress, reduced }: { icon: "person" | "calendar"; label: string; index: number; onPress: () => void; reduced: boolean }) {
  return <Animated.View entering={reduced ? undefined : riseIn({ delay: 40 * index, distance: 4, duration: 220 })}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 10, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: pressed ? "rgba(255,255,255,0.12)" : "transparent", transform: [{ scale: pressed ? 0.96 : 1 }], transitionProperty: ["transform", "backgroundColor"], transitionDuration: 120 } as never)}>
      <BrandIcon name={icon} size={16} color="rgba(255,255,255,0.8)" />
      <Text style={{ fontSize: 15, fontWeight: "500", color: palette.white }}>{label}</Text>
    </Pressable>
  </Animated.View>;
}

/**
 * One sentence and two quiet tokens (after Superlist): owner and due date. Tapping a token opens
 * its choices in place; picking one closes it. The round button commits.
 */
function Composer({ draft, onChange, onSave, pending, error }: { draft: TaskDraft; onChange: (update: Partial<TaskDraft>) => void; onSave: () => void; pending: boolean; error?: string }) {
  const { reducedMotion } = useAccessibleEffects();
  const [open, setOpen] = useState<"owner" | "due" | null>(null);
  const [customOwner, setCustomOwner] = useState(Boolean(draft.owner) && !OWNERS.includes(draft.owner));
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
  const takeOwner = (owner: string) => { haptic("select"); setOpen(null); setCustomOwner(!OWNERS.includes(owner)); set({ owner, title: draft.title.replace(/\s*@[^\s@]*$/, "") }); };
  const takeDue = () => { if (!parsed) return; haptic("select"); setOpen(null); const at = draft.title.toLowerCase().lastIndexOf(parsed.phrase.toLowerCase()); set({ due: parsed.due, title: draft.title.slice(0, at).trimEnd() }); };
  const typed = mention !== undefined ? `@${mention}` : parsed?.phrase;
  const head = typed ? draft.title.slice(0, draft.title.toLowerCase().lastIndexOf(typed.toLowerCase())) : draft.title;
  const tokenIcon = (name: "person" | "calendar", filled: boolean) => <BrandIcon name={name} size={17} color={filled ? palette.blue : palette.muted} />;
  return <Surface feature layout={layout} style={{ padding: 18, gap: 16 }}>
    <View style={{ zIndex: 2 }}>
      {/* The phrase being read is tinted blue in place (children instead of value keep the caret). */}
      <TextInput accessibilityLabel="Task" onChangeText={title => set({ title })} placeholder={'Try “Bloods @nurse in 2 weeks”'} placeholderTextColor="#A2A8B1" multiline maxLength={240} editable={!pending}
        style={{ fontSize: 20, lineHeight: 26, fontWeight: "500", letterSpacing: -0.3, color: palette.ink, padding: 0 }}>
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

    {open === "owner" && <Expand key="owner" style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {/* Tapping the chosen owner again clears it. */}
        {OWNERS.map(owner => <Chip key={owner} label={owner} selected={draft.owner === owner} onPress={() => { haptic("select"); setCustomOwner(false); if (draft.owner === owner) set({ owner: "" }); else { set({ owner }); setOpen(null); } }} />)}
        <Chip label="Someone else" selected={customOwner} onPress={() => { haptic("select"); if (customOwner) { setCustomOwner(false); set({ owner: "" }); return; } setCustomOwner(true); if (OWNERS.includes(draft.owner)) set({ owner: "" }); }} />
      </View>
      {customOwner && <Expand><TextInput autoFocus accessibilityLabel="Owner name or team" value={draft.owner} onChangeText={owner => set({ owner })} placeholder="Name or team" placeholderTextColor="#A2A8B1" maxLength={100} returnKeyType="done" onSubmitEditing={() => setOpen(null)}
        style={{ fontSize: 16, color: palette.ink, paddingHorizontal: 14, height: 44, borderRadius: 14, backgroundColor: "rgba(20,28,40,0.04)" }} /></Expand>}
    </Expand>}

    {open === "due" && <Expand key="due"><DayRuler value={draft.due} onPick={due => set({ due })} /></Expand>}

    {/* With a panel open (or an error), a footer row keeps the corner free below it. */}
    {(open || error) && <Animated.View layout={layout} entering={FadeIn.duration(150)} style={{ minHeight: 40, justifyContent: "center", paddingRight: 52 }}>
      {error && <Text style={{ fontSize: 13, lineHeight: 18, color: palette.amber }}>{error}</Text>}
    </Animated.View>}
    <Animated.View layout={layout} style={{ position: "absolute", right: 18, bottom: 18, zIndex: 1 }}>
      <RoundAction icon="add" size={40} label={error ? "Retry adding task" : "Add task"} hint={missing.length ? `Needs ${missing.join(", ")}` : undefined} ready={ready} onPress={onSave} />
    </Animated.View>
  </Surface>;
}

/** Check marker morphs into a tick and a strike draws across; swipe right does the same. */
function TaskRow({ task, disabled, onToggle }: { task: Task; disabled: boolean; onToggle: () => void }) {
  const { reducedMotion } = useAccessibleEffects();
  const { patient } = useEncounter();
  const [completing, setCompleting] = useState(false);
  useEffect(() => { if (!task.completed) setCompleting(false); }, [task.completed]);
  const done = task.completed || completing;
  const toggle = () => {
    if (disabled) return;
    if (task.completed) { haptic("select"); onToggle(); return; }
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
  const pan = Gesture.Pan().activeOffsetX(14).failOffsetY([-12, 12]).enabled(!disabled)
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
  return <View>
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, bottom: 0, width: 120, borderRadius: 20, backgroundColor: "#E4EDFD", paddingLeft: 22, justifyContent: "center" }, revealStyle]}>
      <BrandIcon name={reopens ? "back" : "check"} size={22} color={palette.blue} strokeWidth={2} />
    </Animated.View>
    <GestureDetector gesture={pan}>
      <Surface style={[{ borderRadius: 20 }, rowStyle]}>
        {/* The whole row is the checkbox; only the Source link inside it does something else. */}
        <Pressable accessibilityRole="checkbox" accessibilityLabel={`${task.title}, ${task.owner}, ${done ? "done" : `due ${friendlyDate(task.due)}`}`} accessibilityState={{ checked: done, disabled }} accessibilityHint={done ? "Reopens the task" : "Marks the task completed"} onPress={toggle} disabled={disabled}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 14, transform: [{ scale: pressed ? 0.98 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
          <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1.6, alignItems: "center", justifyContent: "center", borderColor: done ? palette.blue : "#B7BDC6", backgroundColor: done ? palette.blue : "transparent", transitionProperty: ["backgroundColor", "borderColor"], transitionDuration: 180 } as never}>
            <Animated.View style={{ opacity: done ? 1 : 0, transform: [{ scale: done ? 1 : 0.5 }], transitionProperty: ["opacity", "transform"], transitionDuration: 240, transitionTimingFunction: EASE_OUT }}>
              <BrandIcon name="check" size={15} color={palette.white} strokeWidth={2.4} />
            </Animated.View>
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <View style={{ alignSelf: "flex-start" }}>
              <Text style={{ fontSize: 16, lineHeight: 22, fontWeight: "500", color: done ? palette.muted : palette.ink, transitionProperty: "color", transitionDuration: 200 } as never}>{task.title}</Text>
              <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 11, height: 1.5, borderRadius: 1, backgroundColor: palette.muted, transformOrigin: "left", transform: [{ scaleX: done ? 1 : 0 }], transitionProperty: "transform", transitionDuration: 320, transitionTimingFunction: EASE_OUT }} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ fontSize: 13, color: palette.muted }}>{task.owner} · {done ? "Done" : friendlyDate(task.due)}</Text>
              {source && <Pressable accessibilityRole="link" accessibilityLabel={`Source, ${source.title}`} onPress={openSource} hitSlop={8}><Text style={{ fontSize: 13, color: palette.blue }}>Source ↗</Text></Pressable>}
            </View>
          </View>
        </Pressable>
      </Surface>
    </GestureDetector>
  </View>;
}

function Section({ title, count }: { title: string; count: number }) {
  return <Animated.View layout={LAYOUT} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 10, paddingHorizontal: 4 }}>
    <Text accessibilityRole="header" style={{ fontSize: 15, fontWeight: "600", color: palette.ink }}>{title}</Text>
    <View style={{ minWidth: 24, height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: "rgba(20,28,40,0.06)", alignItems: "center", justifyContent: "center" }}>
      <Animated.Text key={count} entering={riseIn({ distance: 6, scale: 0.9, duration: 220 })} style={{ fontSize: 12, fontWeight: "600", color: palette.muted, fontVariant: ["tabular-nums"] }}>{count}</Animated.Text>
    </View>
  </Animated.View>;
}

/** One card per visit with follow-ups: open count and the next few, tap to work on that visit. */
function VisitFollowUps({ except }: { except?: string }) {
  const { patients, encounters, selectPatient } = useEncounter();
  return <>{patients.filter(p => p.id !== except && encounters[p.id]?.tasks.length).map(p => {
    const pending = encounters[p.id]!.tasks.filter(task => !task.completed);
    return <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`${p.name}, ${pending.length} open follow-ups`} onPress={() => { haptic("select"); selectPatient(p.id); }}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
      <Surface style={{ padding: 16, gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#E6EEFC", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 13, fontWeight: "600", color: palette.blue }}>{p.initials}</Text></View>
          <Text style={{ flex: 1, fontSize: 16, fontWeight: "600", color: palette.ink }}>{p.name}</Text>
          <Text style={{ fontSize: 13, color: palette.muted, fontVariant: ["tabular-nums"] }}>{pending.length ? `${pending.length} open` : "All done"}</Text>
          <View style={{ transform: [{ rotate: "180deg" }] }}><BrandIcon name="back" size={16} color={palette.muted} strokeWidth={1.8} /></View>
        </View>
        {pending.slice(0, 3).map(task => <Text key={task.id} numberOfLines={1} style={{ fontSize: 14, color: palette.ink }}>{task.title}<Text style={{ color: palette.muted }}>  {task.owner} · {friendlyDate(task.due)}</Text></Text>)}
      </Surface>
    </Pressable>;
  })}</>;
}

/** No visit selected: follow-ups across today's visits, and a one-tap way to add one for a visit. */
function AllFollowUps() {
  const { patients, encounters, selectPatient } = useEncounter();
  const any = patients.some(p => encounters[p.id]?.tasks.length);
  return <Screen>
    <Text style={{ fontSize: 13, color: palette.muted }}>Across today's visits · saved for this session only.</Text>
    <VisitFollowUps />
    {!any && <Text style={{ fontSize: 15, color: palette.muted, paddingHorizontal: 4 }}>No follow-ups yet.</Text>}
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: palette.muted, paddingHorizontal: 4 }}>Add a follow-up for</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {patients.map(p => <Chip key={p.id} label={p.name} onPress={() => { haptic("select"); selectPatient(p.id); }} accessibilityLabel={`Add a follow-up for ${p.name}`} />)}
      </View>
    </View>
  </Screen>;
}

export function TasksScreen() {
  const { patient, patients, encounters, encounter, updateEncounter, simulateFailure } = useEncounter();
  const { reducedMotion } = useAccessibleEffects();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activePatient = useRef(patient?.id); activePatient.current = patient?.id;
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
  const save = () => {
    if (!draft || taskDraftErrors(draft).length) return;
    saveLocally(() => { haptic("done"); updateEncounter(current => {
      const next = createTaskOnce(current, draft);
      if (next === current) return current;
      return { ...next, taskDraft: { ...taskProposal(next, patient), operationId: `task-${patient.encounterId}-${Date.now()}`, title: "", owner: "", due: "", provenance: "clinician" } };
    }); });
  };
  const byDue = (a: Task, b: Task) => a.due.localeCompare(b.due);
  const open = encounter.tasks.filter(task => !task.completed).sort(byDue);
  const done = encounter.tasks.filter(task => task.completed);
  const toggle = (id: string) => updateEncounter(current => ({ ...current, tasks: current.tasks.map(value => value.id === id ? { ...value, completed: !value.completed } : value) }));
  const row = (task: Task) => <Animated.View key={task.id} layout={reducedMotion ? undefined : LAYOUT} entering={reducedMotion ? undefined : riseIn({ distance: 10, duration: 320 })} exiting={FadeOut.duration(140)}>
    <TaskRow task={task} disabled={pending} onToggle={() => toggle(task.id)} />
  </Animated.View>;

  return <Screen>
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: palette.blue }}>{patient.name} · {patient.id}</Text>
      <Text style={{ fontSize: 13, color: palette.muted }}>Saved for this session only. Nothing is booked or sent.</Text>
    </View>
    {draft && <Composer key={draft.operationId} draft={draft} pending={pending} error={error} onChange={change => updateEncounter(current => ({ ...current, taskDraft: { ...current.taskDraft!, ...change } }))} onSave={save} />}
    {/* One keyed list, so a completed row glides into Completed instead of remounting there. */}
    {[
      open.length > 0 && <Section key="open" title="Open" count={open.length} />,
      ...open.map(row),
      open.length === 0 && done.length > 0 && <Animated.Text key="all-done" layout={LAYOUT} entering={FadeIn.duration(200)} style={{ fontSize: 15, color: palette.muted, paddingHorizontal: 4 }}>All follow-ups are done.</Animated.Text>,
      done.length > 0 && <Section key="done" title="Completed" count={done.length} />,
      ...done.map(row),
    ]}
    {encounter.tasks.length > 0 && <Text style={{ fontSize: 12, color: palette.muted, paddingHorizontal: 4 }}>Swipe a task right to complete it.</Text>}
    {patients.some(p => p.id !== patient.id && encounters[p.id]?.tasks.length) && <Text accessibilityRole="header" style={{ fontSize: 15, fontWeight: "600", color: palette.ink, paddingTop: 10, paddingHorizontal: 4 }}>Other visits</Text>}
    <VisitFollowUps except={patient.id} />
  </Screen>;
}
