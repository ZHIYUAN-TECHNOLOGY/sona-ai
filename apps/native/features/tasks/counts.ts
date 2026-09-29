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
