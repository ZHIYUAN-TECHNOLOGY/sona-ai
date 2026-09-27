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

// The Schedule calendar. A day is a whole number: days since 1 Jan 1970 in Malaysia (the hospital's
// time), so a day number times DAY is that date's midnight in UTC and reads back with getUTC*.
const MYT = 8 * 3600_000, DAY = 86_400_000;
const civil = (day: number) => new Date(day * DAY);
export type Month = { year: number; month: number };
type Visit = Pick<FollowUp, "date" | "short">;
type Ask = { dueAt: Date | string; day: number };

/** The Malaysia day of a moment. */
export const dayOf = (at: Date | string) => Math.floor((new Date(at).getTime() + MYT) / DAY);
/** The day of the month (1–31). */
export const dateOf = (day: number) => civil(day).getUTCDate();
export const monthOf = (day: number): Month => ({ year: civil(day).getUTCFullYear(), month: civil(day).getUTCMonth() });
export function shiftMonth({ year, month }: Month, by: number): Month {
  const d = new Date(Date.UTC(year, month + by, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}
/** The month pill: "Sep", or "Jan 2027" outside this year. */
export const monthLabel = ({ year, month }: Month, today: number) =>
  new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) + (year === monthOf(today).year ? "" : ` ${year}`);
/** "Sunday 4 October", for VoiceOver. */
export const longDay = (day: number) => civil(day).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).replace(",", "");

/** The month as weeks of day numbers, Monday first; null pads before the 1st and after the last. */
export function monthGrid({ year, month }: Month): (number | null)[][] {
  const first = Date.UTC(year, month, 1) / DAY, count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array<null>((civil(first).getUTCDay() + 6) % 7).fill(null), ...Array.from({ length: count }, (_, i) => first + i)];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/**
 * The dots under a day: a visit (red once overdue), a check-in, and for past days of this week whether
 * every dose was marked taken. `week` is `weekOf`'s review, which ends today.
 */
export type DayMarks = { visit?: "due" | "overdue"; checkIn?: true; doses?: "taken" | "missed" };
export function marksByDay(today: number, visits: Pick<FollowUp, "date" | "status">[], checkIns: Ask[], week: { state: string }[]) {
  const marks: Record<number, DayMarks> = {};
  const at = (day: number) => (marks[day] ??= {});
  for (const v of visits) { const m = at(dayOf(v.date)); if (m.visit !== "overdue") m.visit = v.status === "overdue" ? "overdue" : "due"; }
  for (const c of checkIns) at(dayOf(c.dueAt)).checkIn = true;
  week.forEach(({ state }, i) => {
    const day = today - (week.length - 1 - i);
    if (day < today && (state === "all" || state === "some" || state === "none")) at(day).doses = state === "all" ? "taken" : "missed";
  });
  return marks;
}

/** A day chip's VoiceOver label: "Sunday 4 October, today, Clinic review, Day 7 check-in". */
export function dayA11y(day: number, today: number, visits: Visit[], checkIns: Ask[], marks: DayMarks = {}) {
  return [longDay(day), day === today && "today", ...visits.filter(v => dayOf(v.date) === day).map(v => v.short),
    ...checkIns.filter(c => dayOf(c.dueAt) === day).map(c => `Day ${c.day} check-in`),
    marks.doses && (marks.doses === "taken" ? "all doses taken" : "some doses missed")].filter(Boolean).join(", ");
}

/** The next visit or check-in after a day, for an empty day's jump. */
export function nextUp(after: number, visits: Visit[], checkIns: Ask[]): { day: number; title: string } | undefined {
  return [...visits.map(v => ({ day: dayOf(v.date), title: v.short })), ...checkIns.map(c => ({ day: dayOf(c.dueAt), title: `Day ${c.day} check-in` }))]
    .filter(e => e.day > after).sort((a, b) => a.day - b.day)[0];
}

/** An empty day's line: "Nothing today · Next: Clinic review in 7 days". */
export const emptyLine = (day: number, today: number, next?: { day: number; title: string }) =>
  [day === today ? "Nothing today" : "Nothing this day", next && `Next: ${next.title} ${away(next.day - today)}`].filter(Boolean).join(" · ");
