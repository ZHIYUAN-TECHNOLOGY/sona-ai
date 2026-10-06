import type { ReactNode } from "react";

import { EmptyState } from "@/components/page";

type Q<T> = { data: T | undefined; isPending: boolean; error: Error | null };

/** Loading, refused and empty in plain words; the children only draw real rows. */
export function Loaded<T>({ query, what, empty, children }: { query: Q<T[]>; what: string; empty: string; children: (rows: T[]) => ReactNode }) {
  if (query.isPending) return <EmptyState>Loading {what}…</EmptyState>;
  if (query.error || !query.data) return <EmptyState>Could not load {what}: {query.error?.message ?? "no answer"}. Your role may not be allowed to see this.</EmptyState>;
  if (query.data.length === 0) return <EmptyState>{empty}</EmptyState>;
  return <>{children(query.data)}</>;
}

/** Today as the hospital writes a due date (YYYY-MM-DD, Malaysia). */
export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });

export type TaskFilter = "mine" | "all" | "overdue";
type TaskLike = { owner: string; due: string | null; completed: boolean };

/** Overdue: open, dated, and the date has passed. ISO dates compare as strings. */
export const isOverdue = (t: TaskLike, on: string) => !t.completed && t.due !== null && t.due < on;

export const filterTasks = <T extends TaskLike>(tasks: T[], filter: TaskFilter, me: string, on: string) =>
  filter === "all" ? tasks : filter === "mine" ? tasks.filter(t => t.owner === me) : tasks.filter(t => isOverdue(t, on));
