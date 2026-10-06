import type { IconName } from "@/components/icon";
import { isOverdue } from "@/features/ward/state";

type TaskLike = { title: string; owner: string; due: string | null; completed: boolean; encounterId: string | null; kind: string };

export type TaskTab = "open" | "mine" | "overdue" | "done" | "all";

/** Where a task came from, in plain words: its kind is the only source the list carries. */
const SOURCES: Record<string, { label: string; icon: IconName }> = {
  "check-in": { label: "Patient check-in", icon: "alert" },
  message: { label: "Patient message", icon: "send" },
  followup: { label: "Visit follow-up", icon: "clock" },
  "blocker-owner": { label: "Discharge blocker", icon: "alert" },
  "coding-query": { label: "Coding query", icon: "edit" },
  discharge: { label: "Discharge plan", icon: "check" },
  finding: { label: "Result finding", icon: "activity" },
  booking: { label: "Booking", icon: "clock" },
};
export const sourceOf = (kind: string) => SOURCES[kind] ?? { label: "Added by the care team", icon: "plus" as const };

export function groupTasks<T extends TaskLike>(tasks: T[], me: string, on: string): Record<TaskTab, T[]> & { dueToday: T[] } {
  const open = tasks.filter(t => !t.completed);
  return {
    all: tasks, open, mine: open.filter(t => t.owner === me), overdue: tasks.filter(t => isOverdue(t, on)),
    done: tasks.filter(t => t.completed), dueToday: open.filter(t => t.due === on),
  };
}

export const matchesTask = (t: TaskLike, q: string) =>
  !q || [t.title, t.owner, t.encounterId ?? "ward", sourceOf(t.kind).label].some(s => s.toLowerCase().includes(q));

/** "Sat 3 Oct" for a `YYYY-MM-DD` due date; "Today" on the day; anything that is not a date reads as written. */
export function dueLabel(due: string | null, on: string) {
  if (!due) return "No date";
  if (due === on) return "Today";
  const at = new Date(`${due}T00:00:00Z`);
  return Number.isNaN(at.getTime()) ? due : at.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
