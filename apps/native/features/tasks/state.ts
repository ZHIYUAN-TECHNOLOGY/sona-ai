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

const WEEKDAY_WORDS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
/**
 * Reads a due-date phrase typed at the end of a task sentence ("tomorrow", "in 2 weeks", "10d",
 * "next mon"). Returns the phrase as typed and the date it means, or undefined.
 */
export function parseDuePhrase(text: string, today = new Date()): { phrase: string; due: string } | undefined {
  const at = (days: number) => localDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days));
  const match = text.match(/(?:^|\s)((?:in\s+)?(\d{1,2})\s*(d|days?|w|wks?|weeks?)|today|tomorrow|tmr|next\s+week|(?:next\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*)\s*$/i);
  if (!match) return undefined;
  const phrase = match[1]!, word = phrase.toLowerCase();
  if (word === "today") return { phrase, due: at(0) };
  if (word === "tomorrow" || word === "tmr") return { phrase, due: at(1) };
  if (/^next\s+week$/.test(word)) return { phrase, due: at(7) };
  if (match[2]) {
    const n = Number(match[2]);
    if (!n) return undefined;
    return { phrase, due: at(match[3]!.toLowerCase().startsWith("w") ? n * 7 : n) };
  }
  const day = WEEKDAY_WORDS.indexOf(match[4]!.toLowerCase());
  const full = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][day]!;
  // Only whole or 3-letter weekday names ("mon", "monday"), not other words starting the same.
  if (!full.startsWith(word.replace(/^next\s+/, "")) || word.replace(/^next\s+/, "").length < 3) return undefined;
  return { phrase, due: at(((day - today.getDay() + 7) % 7) || 7) };
}

/** The "@query" being typed at the end of a task sentence, if any. */
export function mentionQuery(text: string): string | undefined {
  return text.match(/(?:^|\s)@([^\s@]*)$/)?.[1];
}
