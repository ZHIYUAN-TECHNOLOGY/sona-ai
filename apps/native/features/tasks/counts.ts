import type { Task } from "@/features/encounter/types";
import { localDate } from "./state";

/** Open follow-ups and how many are overdue (a date before today) or due today. Worded dates ("13 Oct") are neither, except "Today". */
export function taskCounts(tasks: Pick<Task, "due" | "completed">[], today = new Date()) {
  const day = localDate(today);
  const open = tasks.filter(task => !task.completed);
  return {
    open: open.length,
    overdue: open.filter(task => /^\d{4}-\d{2}-\d{2}$/.test(task.due) && task.due < day).length,
    dueToday: open.filter(task => task.due === "Today" || task.due === day).length,
  };
}

export type DueGroup = "overdue" | "today" | "week" | "later";
/** Open tasks read by when they're due, the way a clinician plans: overdue, today, the next 7 days, then later (worded dates too). */
export const DUE_GROUPS: { id: DueGroup; title: string }[] = [{ id: "overdue", title: "Overdue" }, { id: "today", title: "Today" }, { id: "week", title: "This week" }, { id: "later", title: "Later" }];
export function dueGroup(due: string, today = new Date()): DueGroup {
  const day = localDate(today);
  if (due === "Today" || due === day) return "today";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return "later";
  if (due < day) return "overdue";
  const week = localDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7));
  return due <= week ? "week" : "later";
}

/**
 * Open rows ranked by when they're due: Overdue, Today, This week, Later, soonest first within each
 * (the Tasks page, for one visit or across all of them). Empty groups drop out; completed rows are left out.
 */
export function rankByDue<T extends { task: Pick<Task, "due" | "completed"> }>(rows: T[], today = new Date()) {
  const open = rows.filter(r => !r.task.completed).sort((a, b) => a.task.due.localeCompare(b.task.due));
  return DUE_GROUPS.map(g => ({ ...g, rows: open.filter(r => dueGroup(r.task.due, today) === g.id) })).filter(g => g.rows.length);
}
