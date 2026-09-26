import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { shortDate } from "@sona-ai/domain/findings";

export type FollowUp = Awaited<ReturnType<AppRouterClient["care"]["followUps"]>>[number];

const away = (n: number) => n === 0 ? "today" : n === 1 ? "tomorrow" : n === -1 ? "yesterday" : n > 0 ? `in ${n} days` : `${-n} days ago`;
/** "Fri 25 Dec", the day in the hospital's time (Malaysia) whatever the phone says. */
export const dayLabel = (date: Date | string) => new Date(date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur" }).replace(",", "");
/** "Fri 25 Dec · in 90 days". */
export const whenLine = (f: Pick<FollowUp, "date" | "inDays">) => `${dayLabel(f.date)} · ${away(f.inDays)}`;

/** Home's row: the next one in short, amber when due within a week, red once overdue. */
export function nextLine(items: Pick<FollowUp, "short" | "date" | "status">[]): { line: string; tone: "muted" | "amber" | "red" } {
  const next = items[0];
  if (!next) return { line: "Nothing booked yet", tone: "muted" };
  const line = `${next.short} · ${shortDate(next.date)}`;
  return next.status === "overdue" ? { line: `${line} · overdue`, tone: "red" } : { line, tone: next.status === "due-soon" ? "amber" : "muted" };
}

/** How many follow-ups need the patient now (due soon or overdue); counts toward home's insight line. */
export const followUpNeeds = (items: Pick<FollowUp, "status">[] | undefined) => items?.filter(f => f.status !== "upcoming").length ?? 0;
