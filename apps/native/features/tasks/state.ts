import type { Encounter, Patient, Task } from "@/features/encounter/types";

export type TaskDraft = NonNullable<Encounter["taskDraft"]>;
export const proposedTask = "Arrange a follow-up review";
export function taskProposal(encounter: Encounter, patient: Patient): Omit<TaskDraft, "operationId" | "owner" | "due"> {
  const currentPlan = (encounter.noteSectionDraft ?? encounter.noteSections)?.plan?.trim();
  const plan = currentPlan === "To be completed by the clinician." ? "" : currentPlan;
  const sourceId = plan ? "clinical-note" : "history";
  const source = patient.sources.find(value => value.id === sourceId);
  return { title: plan ? plan.slice(0, 240) : proposedTask, sourceId, sourceRevision: encounter.revision, provenance: plan ? "clinician" : "fixture", sourceSnapshot: source ? { ...source } : undefined };
}
export function taskDraftErrors(draft: TaskDraft): string[] {
  const errors: string[] = [];
  if (!draft.title.trim()) errors.push("Add a task title.");
  if (!draft.owner.trim()) errors.push("Assign an owner.");
  const parsed = new Date(`${draft.due}T12:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.due) || Number.isNaN(parsed.getTime()) || localDate(parsed) !== draft.due) errors.push("Choose a valid due date.");
  return errors;
}
export function createTaskOnce(encounter: Encounter, draft: TaskDraft): Encounter {
  if (taskDraftErrors(draft).length || encounter.tasks.some(task => task.id === draft.operationId)) return encounter;
  const task: Task = { id: draft.operationId, title: draft.title.trim(), owner: draft.owner.trim(), due: draft.due, completed: false, sourceId: draft.sourceId, sourceRevision: draft.sourceRevision, provenance: draft.provenance, sourceSnapshot: draft.sourceSnapshot ? { ...draft.sourceSnapshot } : undefined };
  return { ...encounter, tasks: [...encounter.tasks, task] };
}
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function readableDate(date: string): string {
  return date ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Not set";
}
