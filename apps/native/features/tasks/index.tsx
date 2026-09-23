import { Text } from "@/components/sona/text";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cubicBezier, FadeIn, FadeOut, interpolate, LinearTransition, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { BrandIcon } from "@/components/sona/brand-icon";
import { riseIn } from "@/components/sona/motion";
import { Action, Body, Card, Notice, Screen, SourceLink, useAccessibleEffects } from "@/components/sona/ui";
import { palette } from "@/components/sona/theme";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps, Task } from "@/features/encounter/types";
import { createTaskOnce, localDate, proposedTask, readableDate, taskDraftErrors, taskProposal, type TaskDraft } from "./state";

export function FollowupCard({ patient, onOpen, onSource }: FeatureProps) {
  const { encounter } = useEncounter();
  const created = encounter?.tasks ?? [];
  const proposal = encounter?.taskDraft ?? (encounter ? taskProposal(encounter, patient) : undefined);
  return <Card label="Follow-up · local simulation" title={created.length ? "Keep the next step in sight" : "A clear next step"} footer={created.length ? undefined : proposal ? <TaskOrigin value={proposal} /> : <SourceLink label="Encounter context" onPress={() => onSource("history")} />}>
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
const ROW_LAYOUT = LinearTransition.springify().damping(22).stiffness(220);

function haptic(kind: "select" | "done") {
  if (process.env.EXPO_OS !== "ios") return;
  (kind === "done" ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : Haptics.selectionAsync()).catch(() => {});
}
function dayFromToday(days: number) { const t = new Date(); return localDate(new Date(t.getFullYear(), t.getMonth(), t.getDate() + days)); }
function friendlyDate(due: string) {
  if (!due) return "";
  if (due === dayFromToday(0)) return "Today";
  if (due === dayFromToday(1)) return "Tomorrow";
  return new Date(`${due}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
const QUICK_DATES = [["Today", 0], ["Tomorrow", 1], ["In 3 days", 3], ["In 1 week", 7], ["In 2 weeks", 14]] as const;

function Chip({ icon, text, placeholder, open, onPress, label }: { icon: "person" | "calendar"; text: string; placeholder: string; open: boolean; onPress: () => void; label: string }) {
  const filled = Boolean(text);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} onPress={onPress}
    style={({ pressed }) => ({ height: 38, paddingHorizontal: 13, borderRadius: 19, flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderColor: open ? palette.blue : "transparent", backgroundColor: filled ? "#E4EDFD" : "rgba(20,28,40,0.05)", transform: [{ scale: pressed ? 0.96 : 1 }], transitionProperty: ["transform", "backgroundColor", "borderColor"], transitionDuration: 160 } as never)}>
    <BrandIcon name={icon} size={17} color={filled ? palette.blue : palette.muted} />
    <Animated.Text key={text || placeholder} entering={FadeIn.duration(180)} style={{ fontSize: 15, fontWeight: "500", color: filled ? palette.blue : palette.muted }}>{text || placeholder}</Animated.Text>
  </Pressable>;
}
function Option({ text, selected, onPress }: { text: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: "center", backgroundColor: selected ? palette.ink : palette.white, borderWidth: 1, borderColor: selected ? palette.ink : "rgba(20,28,40,0.1)", transform: [{ scale: pressed ? 0.96 : 1 }], transitionProperty: ["transform", "backgroundColor"], transitionDuration: 140 } as never)}>
    <Text style={{ fontSize: 14, fontWeight: "500", color: selected ? palette.white : palette.ink }}>{text}</Text>
  </Pressable>;
}

function Origin({ value }: { value: Pick<Task, "sourceId" | "sourceRevision" | "provenance" | "sourceSnapshot"> & { id?: string; operationId?: string } }) {
  const { patient } = useEncounter();
  const source = value.sourceSnapshot ?? patient?.sources.find(item => item.id === value.sourceId);
  const who = value.provenance === "clinician" ? "Clinician-entered" : value.provenance === "fixture" ? "Authored proposal" : "Origin not recorded";
  if (!source || !patient) return <Text style={{ fontSize: 12, color: palette.muted }}>{who} · no source linked</Text>;
  return <Pressable accessibilityRole="link" accessibilityLabel={`${who}. Source ${source.title}${value.sourceRevision ? `, revision ${value.sourceRevision}` : ""}`} hitSlop={8}
    onPress={() => router.push({ pathname: "/source", params: { id: source.id, patientId: patient.id, revision: String(value.sourceRevision ?? ""), taskId: value.id ?? value.operationId ?? "" } })}>
    <Text numberOfLines={1} style={{ fontSize: 12, color: palette.muted }}>{who} · <Text style={{ color: palette.blue }}>{source.title}{value.sourceRevision ? ` · rev ${value.sourceRevision}` : ""} ↗</Text></Text>
  </Pressable>;
}

/** One sentence plus owner and date chips; each chip opens its own quick picker in place. */
function Composer({ draft, onChange, onSave, onCancel, pending, error, mode }: { draft: TaskDraft; onChange: (update: Partial<TaskDraft>) => void; onSave: () => void; onCancel?: () => void; pending: boolean; error?: string; mode: "new" | "edit" }) {
  const { reducedMotion } = useAccessibleEffects();
  const [open, setOpen] = useState<"owner" | "due" | null>(null);
  const [customOwner, setCustomOwner] = useState(Boolean(draft.owner) && !OWNERS.includes(draft.owner));
  const [pickDate, setPickDate] = useState(false);
  const [candidate, setCandidate] = useState(() => draft.due ? new Date(`${draft.due}T12:00:00`) : new Date());
  const errors = taskDraftErrors(draft);
  const missing = [!draft.title.trim() && "a task", !draft.owner.trim() && "an owner", !draft.due && "a due date"].filter(Boolean) as string[];
  const toggle = (next: "owner" | "due") => { haptic("select"); setOpen(current => current === next ? null : next); };
  const set = (update: Partial<TaskDraft>) => onChange({ ...update, provenance: "clinician" });
  const enter = reducedMotion ? FadeIn.duration(120) : riseIn({ distance: 8, scale: 0.98, duration: 260 });
  return <Animated.View layout={reducedMotion ? undefined : ROW_LAYOUT} style={{ backgroundColor: palette.white, borderRadius: 26, borderCurve: "continuous", padding: 18, gap: 14, boxShadow: "0 8px 30px rgba(24,32,48,0.08)" }}>
    <Text style={{ fontSize: 12, fontWeight: "600", letterSpacing: 0.6, color: palette.muted }}>{mode === "new" ? "NEXT STEP" : "EDIT TASK"}</Text>
    <TextInput accessibilityLabel="Task" value={draft.title} onChangeText={title => set({ title })} placeholder="What needs to happen next?" placeholderTextColor="#A2A8B1" multiline maxLength={240} editable={!pending}
      style={{ fontSize: 22, lineHeight: 28, fontWeight: "500", letterSpacing: -0.3, color: palette.ink, padding: 0 }} />
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Chip icon="person" text={draft.owner} placeholder="Assign owner" open={open === "owner"} onPress={() => toggle("owner")} label={draft.owner ? `Owner, ${draft.owner}. Change` : "Assign owner"} />
      <Chip icon="calendar" text={friendlyDate(draft.due)} placeholder="Add due date" open={open === "due"} onPress={() => toggle("due")} label={draft.due ? `Due ${friendlyDate(draft.due)}. Change` : "Add due date"} />
    </View>

    {open === "owner" && <Animated.View entering={enter} exiting={FadeOut.duration(120)} style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {OWNERS.map(owner => <Option key={owner} text={owner} selected={draft.owner === owner} onPress={() => { haptic("select"); setCustomOwner(false); set({ owner }); setOpen(null); }} />)}
        <Option text="Someone else…" selected={customOwner} onPress={() => { haptic("select"); setCustomOwner(true); if (OWNERS.includes(draft.owner)) set({ owner: "" }); }} />
      </View>
      {customOwner && <TextInput autoFocus accessibilityLabel="Owner name or team" value={draft.owner} onChangeText={owner => set({ owner })} placeholder="Name or team" placeholderTextColor="#A2A8B1" maxLength={100} returnKeyType="done" onSubmitEditing={() => setOpen(null)}
        style={{ fontSize: 16, color: palette.ink, paddingHorizontal: 14, height: 44, borderRadius: 14, backgroundColor: "#F1F3F6" }} />}
    </Animated.View>}

    {open === "due" && <Animated.View entering={enter} exiting={FadeOut.duration(120)} style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {QUICK_DATES.map(([text, days]) => { const due = dayFromToday(days); return <Option key={text} text={text} selected={draft.due === due && !pickDate} onPress={() => { haptic("select"); setPickDate(false); set({ due }); setOpen(null); }} />; })}
        <Option text="Pick a date…" selected={pickDate} onPress={() => { haptic("select"); setPickDate(value => !value); }} />
      </View>
      {pickDate && <Animated.View entering={enter} style={{ gap: 10 }}>
        <DateTimePicker value={candidate} mode="date" display="inline" presentation="inline" onValueChange={(_, date) => setCandidate(date)} themeVariant="light" accentColor={palette.blue} />
        <Action label={`Use ${friendlyDate(localDate(candidate))}`} onPress={() => { set({ due: localDate(candidate) }); setPickDate(false); setOpen(null); }} />
      </Animated.View>}
    </Animated.View>}

    <Origin value={draft} />
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: error ? palette.amber : palette.muted }}>{error ?? (pending ? "Saving to this session…" : missing.length ? `Add ${missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}` : missing[0]}` : "Ready")}</Text>
      {onCancel && <Pressable accessibilityRole="button" onPress={onCancel} disabled={pending} hitSlop={8}><Text style={{ fontSize: 15, color: palette.muted, fontWeight: "500" }}>Cancel</Text></Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel={error ? "Retry" : mode === "new" ? "Add task" : "Save changes"} accessibilityState={{ disabled: pending || errors.length > 0 }} disabled={pending || errors.length > 0} onPress={onSave}
        style={({ pressed }) => ({ height: 44, paddingHorizontal: 20, borderRadius: 22, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: errors.length || pending ? "#C9CDD3" : palette.ink, transform: [{ scale: pressed ? 0.96 : 1 }], transitionProperty: ["transform", "backgroundColor"], transitionDuration: 160 } as never)}>
        <BrandIcon name={mode === "new" ? "add" : "check"} size={17} color={palette.white} strokeWidth={2} />
        <Text style={{ fontSize: 15, fontWeight: "600", color: palette.white }}>{pending ? "Saving…" : error ? "Retry" : mode === "new" ? "Add task" : "Save"}</Text>
      </Pressable>
    </View>
  </Animated.View>;
}

/** Check marker morphs into a tick and a strike draws across; swipe right does the same. */
function TaskRow({ task, disabled, onToggle, onEdit }: { task: Task; disabled: boolean; onToggle: () => void; onEdit: () => void }) {
  const { reducedMotion } = useAccessibleEffects();
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
  const tx = useSharedValue(0);
  const pan = Gesture.Pan().activeOffsetX(14).failOffsetY([-12, 12]).enabled(!disabled)
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
      <BrandIcon name={task.completed ? "back" : "check"} size={22} color={palette.blue} strokeWidth={2} />
    </Animated.View>
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ flexDirection: "row", alignItems: "flex-start", gap: 14, padding: 16, borderRadius: 20, borderCurve: "continuous", backgroundColor: palette.white, boxShadow: "0 4px 18px rgba(24,32,48,0.05)" }, rowStyle]}>
        <Pressable accessibilityRole="checkbox" accessibilityLabel={task.title} accessibilityState={{ checked: done, disabled }} accessibilityHint={done ? "Reopens the task" : "Marks the task completed"} onPress={toggle} hitSlop={10}
          style={{ width: 26, height: 26, marginTop: 1, borderRadius: 13, borderWidth: 1.8, alignItems: "center", justifyContent: "center", borderColor: done ? palette.blue : "#B7BDC6", backgroundColor: done ? palette.blue : "transparent", transitionProperty: ["backgroundColor", "borderColor"], transitionDuration: 180 } as never}>
          <Animated.View style={{ opacity: done ? 1 : 0, transform: [{ scale: done ? 1 : 0.5 }], transitionProperty: ["opacity", "transform"], transitionDuration: 240, transitionTimingFunction: EASE_OUT }}>
            <BrandIcon name="check" size={16} color={palette.white} strokeWidth={2.4} />
          </Animated.View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${task.title}`} onPress={onEdit} disabled={disabled} style={{ flex: 1, gap: 4 }}>
          <View>
            <Text style={{ fontSize: 17, lineHeight: 23, fontWeight: "500", color: done ? palette.muted : palette.ink, transitionProperty: "color", transitionDuration: 200 } as never}>{task.title}</Text>
            <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 11.5, height: 1.5, borderRadius: 1, backgroundColor: palette.muted, transformOrigin: "left", transform: [{ scaleX: done ? 1 : 0 }], transitionProperty: "transform", transitionDuration: 320, transitionTimingFunction: EASE_OUT }} />
          </View>
          <Text style={{ fontSize: 14, color: palette.muted }}>{task.owner} · {done ? "Completed" : `Due ${friendlyDate(task.due)}`}</Text>
          <Origin value={task} />
        </Pressable>
      </Animated.View>
    </GestureDetector>
  </View>;
}

function Section({ title, count }: { title: string; count: number }) {
  return <Animated.View layout={ROW_LAYOUT} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 10, paddingHorizontal: 4 }}>
    <Text accessibilityRole="header" style={{ fontSize: 15, fontWeight: "600", color: palette.ink }}>{title}</Text>
    <View style={{ minWidth: 24, height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: "rgba(20,28,40,0.06)", alignItems: "center", justifyContent: "center" }}>
      <Animated.Text key={count} entering={riseIn({ distance: 6, scale: 0.9, duration: 220 })} style={{ fontSize: 12, fontWeight: "600", color: palette.muted, fontVariant: ["tabular-nums"] }}>{count}</Animated.Text>
    </View>
  </Animated.View>;
}

export function TasksScreen() {
  const { patient, encounter, updateEncounter, simulateFailure } = useEncounter();
  const { reducedMotion } = useAccessibleEffects();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activePatient = useRef(patient?.id); activePatient.current = patient?.id;
  const editingDraft = encounter?.taskEditDraft;
  const editingId = editingDraft?.operationId;
  useEffect(() => {
    if (!patient || !encounter || encounter.taskDraft) return;
    const draft: TaskDraft = { operationId: `task-${patient.encounterId}-${Date.now()}`, owner: "", due: "", ...taskProposal(encounter, patient) };
    updateEncounter(current => current.taskDraft ? current : { ...current, taskDraft: draft });
  }, [patient, encounter, updateEncounter]);
  useEffect(() => { setError(undefined); setPending(false); pendingRef.current = false; return () => { if (saveTimer.current) clearTimeout(saveTimer.current); }; }, [patient?.id]);
  if (!patient || !encounter) return <Screen><Notice>Choose a patient to plan a follow-up.</Notice></Screen>;
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
  const edit = (task: Task) => { setError(undefined); updateEncounter(current => ({ ...current, taskEditDraft: { operationId: task.id, title: task.title, owner: task.owner, due: task.due, sourceId: task.sourceId, sourceRevision: task.sourceRevision, provenance: task.provenance, sourceSnapshot: task.sourceSnapshot } })); };
  const row = (task: Task) => editingId === task.id && editingDraft
    ? <Composer key={task.id} mode="edit" draft={editingDraft} pending={pending} error={error} onChange={change => updateEncounter(current => ({ ...current, taskEditDraft: { ...current.taskEditDraft!, ...change } }))}
      onCancel={() => { updateEncounter(current => ({ ...current, taskEditDraft: undefined })); setError(undefined); }}
      onSave={() => {
        if (taskDraftErrors(editingDraft).length) return;
        saveLocally(() => updateEncounter(current => ({ ...current, taskEditDraft: undefined, tasks: current.tasks.map(value => value.id === task.id ? { ...value, title: editingDraft.title.trim(), owner: editingDraft.owner.trim(), due: editingDraft.due, sourceId: editingDraft.sourceId, sourceRevision: editingDraft.sourceRevision, provenance: editingDraft.provenance, sourceSnapshot: editingDraft.sourceSnapshot } : value) })));
      }} />
    : <Animated.View key={task.id} layout={reducedMotion ? undefined : ROW_LAYOUT} entering={reducedMotion ? undefined : riseIn({ distance: 10, duration: 320 })} exiting={FadeOut.duration(140)}>
      <TaskRow task={task} disabled={pending || Boolean(editingId)} onToggle={() => toggle(task.id)} onEdit={() => edit(task)} />
    </Animated.View>;

  return <Screen>
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: palette.blue }}>{patient.name} · {patient.id}</Text>
      <Text style={{ fontSize: 13, color: palette.muted }}>Saved for this session only. Nothing is booked or sent.</Text>
    </View>
    {draft && <Composer key={draft.operationId} mode="new" draft={draft} pending={pending && !editingId} error={editingId ? undefined : error} onChange={change => updateEncounter(current => ({ ...current, taskDraft: { ...current.taskDraft!, ...change } }))} onSave={save} />}
    {/* One keyed list, so a completed row glides into Completed instead of remounting there. */}
    {[
      open.length > 0 && <Section key="open" title="Open" count={open.length} />,
      ...open.map(row),
      open.length === 0 && done.length > 0 && <Animated.Text key="all-done" layout={ROW_LAYOUT} entering={FadeIn.duration(200)} style={{ fontSize: 15, color: palette.muted, paddingHorizontal: 4 }}>All follow-ups are done.</Animated.Text>,
      done.length > 0 && <Section key="done" title="Completed" count={done.length} />,
      ...done.map(row),
    ]}
    {encounter.tasks.length > 0 && <Text style={{ fontSize: 12, color: palette.muted, paddingHorizontal: 4 }}>Swipe right or tap the circle to complete. Tap a task to edit it.</Text>}
  </Screen>;
}
