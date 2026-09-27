import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { shortDate } from "@sona-ai/domain/findings";

export type FollowUp = Awaited<ReturnType<AppRouterClient["care"]["followUps"]>>[number];

export const away = (n: number) => n === 0 ? "today" : n === 1 ? "tomorrow" : n === -1 ? "yesterday" : n > 0 ? `in ${n} days` : `${-n} days ago`;
/** "Fri 25 Dec", the day in the hospital's time (Malaysia) whatever the phone says. */
export const dayLabel = (date: Date | string) => new Date(date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur" }).replace(",", "");
/** "Fri 25 Dec · in 90 days". */
export const whenLine = (f: Pick<FollowUp, "date" | "inDays">) => `${dayLabel(f.date)} · ${away(f.inDays)}`;

/** "10:30 AM" in Malaysia for a booked visit; a recall or the discharge review has a due day, not a time. */
export const timeLabel = (f: Pick<FollowUp, "id" | "date">) => f.id.startsWith("recall:") || f.id === "discharge-review" ? undefined
  : new Date(f.date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" });
/** The visit card's pill: "Fri 25 Dec · 10:30 AM", or just the day. */
export const pillLine = (f: Pick<FollowUp, "id" | "date">) => [dayLabel(f.date), timeLabel(f)].filter(Boolean).join(" · ");
/** What to bring: paperwork only, since the data holds no preparation steps for a visit or test. */
export const bringLine = (f: Pick<FollowUp, "id">) => f.id === "discharge-review" ? "Bring your IC, your discharge letter and your medicines." : "Bring your IC and your medicines, or a list of them.";

/** Home's tile: the next one's date, what it is and how far off, amber when due within a week, red once overdue. */
export function nextVisit(items: Pick<FollowUp, "short" | "date" | "status" | "inDays">[]): { value: string; line: string; tone: "muted" | "amber" | "red" } {
  const next = items[0];
  if (!next) return { value: "—", line: "Nothing booked yet", tone: "muted" };
  const value = shortDate(next.date), line = `${next.short} · ${away(next.inDays)}`;
  return next.status === "overdue" ? { value, line: `${next.short} · overdue`, tone: "red" } : { value, line, tone: next.status === "due-soon" ? "amber" : "muted" };
}

/** How many follow-ups need the patient now (due soon or overdue); counts toward home's insight line. */
export const followUpNeeds = (items: Pick<FollowUp, "status">[] | undefined) => items?.filter(f => f.status !== "upcoming").length ?? 0;

/** My visits' insight under the title: "Next: Clinic review in 7 days", amber when due soon, red once overdue. */
export function visitsLine(items: Pick<FollowUp, "short" | "status" | "inDays">[]): { line: string; tone: "muted" | "amber" | "red" } | undefined {
  const next = items[0];
  if (!next) return undefined;
  return next.status === "overdue" ? { line: `Overdue: ${next.short}, due ${away(next.inDays)}`, tone: "red" }
    : { line: `Next: ${next.short} ${away(next.inDays)}`, tone: next.status === "due-soon" ? "amber" : "muted" };
}

/** A timeline dot: red when overdue, blue for the next one, grey for later. */
export const dotTone = (f: Pick<FollowUp, "status">, next: boolean) => f.status === "overdue" ? "red" : next ? "blue" : "faint";
