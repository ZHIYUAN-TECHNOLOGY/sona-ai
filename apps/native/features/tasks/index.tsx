import { Text } from "@/components/sona/text";
import { Host, TextInput } from "@expo/ui";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Action, Body, Card, Label, Notice, Screen, SourceLink } from "@/components/sona/ui";
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

function NativeTextField({ label, value, onChange, placeholder, multiline = false, disabled = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; multiline?: boolean; disabled?: boolean }) {
  return <View style={{ gap: 6 }}><Label muted>{label}</Label><Host matchContents={{ vertical: true }} colorScheme="light" style={{ minHeight: 48 }}><TextInput defaultValue={value} editable={!disabled} onChangeText={onChange} placeholder={placeholder} multiline={multiline} maxLength={multiline ? 240 : 100} testID={`task-${label.toLowerCase()}`} textStyle={{ color: palette.ink, fontSize: 17 }} style={{ padding: 12, backgroundColor: "#EDF0F5", borderRadius: 12 }} /></Host></View>;
}

function TaskForm({ draft, onChange, onSave, label, pending = false }: { draft: TaskDraft; onChange: (update: Partial<TaskDraft>) => void; onSave: () => void; label: string; pending?: boolean }) {
  const [chooseDate, setChooseDate] = useState(false);
  const [candidateDate, setCandidateDate] = useState(() => draft.due ? new Date(`${draft.due}T12:00:00`) : new Date());
  const errors = taskDraftErrors(draft);
  return <View style={{ gap: 16 }}>
    <TaskOrigin value={draft} />
    <NativeTextField label="Title" value={draft.title} onChange={title => onChange({ title, provenance: "clinician" })} placeholder="What needs to happen?" multiline disabled={pending} />
    <NativeTextField label="Owner" value={draft.owner} onChange={owner => onChange({ owner, provenance: "clinician" })} placeholder="Enter a name or team" disabled={pending} />
    <View style={{ gap: 10 }}><Label muted>Due date</Label><Body>{readableDate(draft.due)}</Body><Action label={draft.due ? "Change date" : "Choose a date"} secondary icon="calendar" disabled={pending} onPress={() => setChooseDate(value => !value)} />
      {chooseDate && <View style={{ gap: 10 }}><DateTimePicker value={candidateDate} mode="date" display="inline" presentation="inline" disabled={pending} onValueChange={(_, date) => setCandidateDate(date)} themeVariant="light" accentColor={palette.blue} /><Action label={`Use ${readableDate(localDate(candidateDate))}`} disabled={pending} onPress={() => { onChange({ due: localDate(candidateDate), provenance: "clinician" }); setChooseDate(false); }} /><Action label="Cancel date selection" secondary disabled={pending} onPress={() => setChooseDate(false)} /></View>}
    </View>
    {errors.length > 0 && <Notice>{errors.join(" ")}</Notice>}
    {pending && <Notice>Saving local simulation… Closing this screen keeps the draft and cancels the pending save.</Notice>}
    <Action label={pending ? "Saving…" : label} icon="checkmark" disabled={pending || errors.length > 0} onPress={onSave} />
  </View>;
}

export function TasksScreen() {
  const { patient, encounter, updateEncounter, simulateFailure } = useEncounter();
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
  const created = draft && encounter.tasks.find(task => task.id === draft.operationId);
  const saveLocally = (apply: () => void) => {
    if (pendingRef.current) return;
    const patientId = patient.id;
    pendingRef.current = true; setPending(true); setError(undefined);
    // Fixture transport exposes pending/retry states without a backend request.
    saveTimer.current = setTimeout(() => {
      if (activePatient.current !== patientId) return;
      if (simulateFailure) setError("The simulated save failed. Your draft is kept; retry uses the same task identity.");
      else apply();
      pendingRef.current = false; setPending(false);
    }, 320);
  };
  const save = () => {
    if (!draft || taskDraftErrors(draft).length) return;
    saveLocally(() => updateEncounter(current => createTaskOnce(current, draft)));
  };
  return <Screen>
    <Label>{patient.name} · {patient.id}</Label>
    <Notice>Tasks are saved for this app session. No appointment is booked or message sent.</Notice>
    {!created && draft && <Card label="Proposal" title="Make the next step clear"><TaskForm key={draft.operationId} draft={draft} pending={pending} onChange={change => updateEncounter(current => ({ ...current, taskDraft: { ...current.taskDraft!, ...change } }))} onSave={save} label={error ? "Retry create task" : "Create task"} />{error && <Notice warning>{error}</Notice>}</Card>}
    {created && <Card label="Task created" title="Follow-up is recorded"><TaskSummary task={created} /><Notice>Saved in this synthetic encounter. Repeated create requests cannot add a duplicate.</Notice><Action label="Plan another task" secondary icon="plus" disabled={pending} onPress={() => { setError(undefined); updateEncounter(current => ({ ...current, taskDraft: { operationId: `task-${patient.encounterId}-${Date.now()}`, owner: "", due: "", ...taskProposal(current, patient) } })); }} /></Card>}
    {encounter.tasks.length > 0 && <Label muted>Encounter tasks · {encounter.tasks.length}</Label>}
    {encounter.tasks.map(task => <Card key={task.id}>
      {editingId === task.id && editingDraft ? <><TaskForm key={`edit-${task.id}`} draft={editingDraft} pending={pending} onChange={change => updateEncounter(current => ({ ...current, taskEditDraft: { ...current.taskEditDraft!, ...change } }))} label="Save changes" onSave={() => {
        if (taskDraftErrors(editingDraft).length) return;
        saveLocally(() => updateEncounter(current => ({ ...current, taskEditDraft: undefined, tasks: current.tasks.map(value => value.id === task.id ? { ...value, title: editingDraft.title.trim(), owner: editingDraft.owner.trim(), due: editingDraft.due, sourceId: editingDraft.sourceId, sourceRevision: editingDraft.sourceRevision, provenance: editingDraft.provenance, sourceSnapshot: editingDraft.sourceSnapshot } : value) })));
      }} />{error && <Notice warning>{error}</Notice>}<Action label="Discard these edits" secondary disabled={pending} onPress={() => { updateEncounter(current => ({ ...current, taskEditDraft: undefined })); setError(undefined); }} /></> : <><TaskSummary task={task} /><View style={{ gap: 10 }}><Action label={task.completed ? "Reopen task" : "Mark completed"} icon={task.completed ? "arrow.uturn.backward" : "checkmark.circle"} disabled={pending} onPress={() => updateEncounter(current => ({ ...current, tasks: current.tasks.map(value => value.id === task.id ? { ...value, completed: !value.completed } : value) }))} /><Action label="Edit details" secondary icon="pencil" disabled={pending || Boolean(editingId)} onPress={() => { updateEncounter(current => ({ ...current, taskEditDraft: { operationId: task.id, title: task.title, owner: task.owner, due: task.due, sourceId: task.sourceId, sourceRevision: task.sourceRevision, provenance: task.provenance, sourceSnapshot: task.sourceSnapshot } })); setError(undefined); }} /></View></>}
    </Card>)}
  </Screen>;
}
