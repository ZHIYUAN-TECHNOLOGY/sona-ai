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

type BedLike = { status: string; blockers: { id: string }[] };

/** How many of a bed's blockers nobody owns yet. `owners` is keyed by blocker id. */
export const unownedOn = (bed: BedLike, owners: ReadonlyMap<string, unknown>) => bed.blockers.filter(x => !owners.has(x.id)).length;

/** Beds that need someone first: a blocker without an owner, then blocked, then watched. Ties keep the server's order. */
export const rankBeds = <T extends BedLike>(beds: T[], owners: ReadonlyMap<string, unknown>) => {
  const need = (b: T) => unownedOn(b, owners) > 0 ? 3 : b.blockers.length > 0 ? 2 : b.status === "watch" ? 1 : 0;
  return [...beds].sort((a, b) => need(b) - need(a));
};

/** A bed's forecast as a phrase: a time or a day reads "Free 11:00"; anything else ("Awaiting rehab") stands alone. */
export const freeBy = (predicted: string) => /^(\d|now|tomorrow|in |once )/i.test(predicted) ? `Free ${predicted[0]!.toLowerCase()}${predicted.slice(1)}` : predicted;

export type TaskFilter ="mine" | "all" | "overdue";
type TaskLike = { owner: string; due: string | null; completed: boolean };

/** Overdue: open, dated, and the date has passed. ISO dates compare as strings. */
export const isOverdue = (t: TaskLike, on: string) => !t.completed && t.due !== null && t.due < on;

export const filterTasks = <T extends TaskLike>(tasks: T[], filter: TaskFilter, me: string, on: string) =>
  filter === "all" ? tasks : filter === "mine" ? tasks.filter(t => t.owner === me) : tasks.filter(t => isOverdue(t, on));
