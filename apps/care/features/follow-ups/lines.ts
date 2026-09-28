import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { shortDate } from "@sona-ai/domain/findings";
import { statusOf, type CheckIn } from "../check-ins/model";
import { clock, dueNow, untilLine, type DayDose } from "../doses/model";

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

// The Schedule strip. A day is a whole number: days since 1 Jan 1970 in Malaysia (the hospital's
// time), so a day number times DAY is that date's midnight in UTC and reads back with getUTC*.
const MYT = 8 * 3600_000, DAY = 86_400_000;
const civil = (day: number) => new Date(day * DAY);
type Visit = Pick<FollowUp, "date" | "short">;
type Ask = { dueAt: Date | string; day: number };

/** The Malaysia day of a moment. */
export const dayOf = (at: Date | string) => Math.floor((new Date(at).getTime() + MYT) / DAY);
/** The day of the month (1–31). */
export const dateOf = (day: number) => civil(day).getUTCDate();
/** "Sunday 4 October", for VoiceOver. */
export const longDay = (day: number) => civil(day).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).replace(",", "");
/** The Monday-first week holding a day, as seven day numbers. */
export function weekAround(day: number): number[] {
  const monday = day - (civil(day).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => monday + i);
}
/** The week strip's head: "28 Sep – 4 Oct". */
export const weekLabel = (week: number[]) => [week[0]!, week[6]!].map(d => civil(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })).join(" – ");

/**
 * The dots under a day: a visit (overdue kept apart), a check-in, and for past days of this week whether
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

export type Tone = "muted" | "blue" | "amber" | "green";
/**
 * One stop on a day's timeline: its time (none for an all-day item), title, one line of state, whether
 * it is done, and at most one inline action: take the doses, answer the check-in, or read before the visit.
 * `soon` is how the insight line names it when it is next ("check-in at 9:00 AM").
 */
export type AgendaItem = { key: string; at?: Date; title: string; line: string; tone: Tone; done: boolean; action?: "take" | "answer" | "prepare"; soon: string; visit?: FollowUp };

const partOf = (at: Date) => { const h = new Date(at.getTime() + MYT).getUTCHours(); return h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening"; };

/**
 * A day's timeline, all-day items first, then by time: doses grouped by their time ("Morning medicines"),
 * check-ins, visits, and for a past day whether every dose was taken.
 */
export function agendaOf(now: Date, { visits, checkIns, doses, doseMark }: { visits: FollowUp[]; checkIns: CheckIn[]; doses: DayDose[]; doseMark?: DayMarks["doses"] }): AgendaItem[] {
  const slots = new Map<number, DayDose[]>();
  for (const d of doses) slots.set(d.dueAt.getTime(), [...slots.get(d.dueAt.getTime()) ?? [], d]);
  const items: AgendaItem[] = [
    ...[...slots].map(([t, group]): AgendaItem => {
      const at = new Date(t), done = group.every(d => d.taken), until = untilLine(at, now), late = !done && until.endsWith("late");
      const title = `${partOf(at)} medicines`, names = group.map(d => d.name).join(", ");
      return { key: `doses@${t}`, at, title, done, line: done ? `Taken · ${names}` : late ? `${until} · ${names}` : names, tone: done ? "green" : late ? "amber" : "muted",
        action: !done && dueNow(at, now) ? "take" : undefined, soon: `${title.toLowerCase()} ${late ? until : `at ${clock(at)}`}` };
    }),
    ...checkIns.map((c): AgendaItem => {
      const s = statusOf(c, now), at = new Date(c.dueAt), done = c.replies.length > 0, waiting = !done && s.tone === "blue";
      return { key: c.id, at, title: `Day ${c.day} check-in`, line: s.line, tone: s.tone, done, action: waiting ? "answer" : undefined, soon: waiting ? "check-in, waiting for you" : `check-in at ${clock(at)}` };
    }),
    ...visits.map((f): AgendaItem => {
      const time = timeLabel(f), overdue = f.status === "overdue";
      return { key: f.id, at: time ? new Date(f.date) : undefined, title: f.title, line: overdue ? `Overdue, due ${away(f.inDays)}` : f.why, tone: overdue ? "amber" : "muted", done: false,
        action: "prepare", soon: overdue ? "visit overdue" : `visit ${time && f.inDays === 0 ? `at ${time}` : away(f.inDays)}`, visit: f };
    }),
  ];
  if (doseMark) items.push({ key: "doses", title: "Medicines", line: doseMark === "taken" ? "All doses taken" : "Some doses missed", tone: doseMark === "taken" ? "green" : "amber", done: doseMark === "taken", soon: "medicines" });
  return items.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
}

/** Schedule's insight under the title: "Next: check-in at 9:00 AM · visit in 3 days", amber when late or overdue. */
export function scheduleLine(today: AgendaItem[], visits: Pick<FollowUp, "id" | "status" | "inDays">[]): { line: string; tone: "muted" | "amber" } {
  const next = today.find(i => !i.done), visit = visits[0];
  const parts = [next ? `Next: ${next.soon}` : today.length ? "All done today" : undefined,
    visit && visit.id !== next?.key && (visit.status === "overdue" ? "visit overdue" : `visit ${away(visit.inDays)}`)].filter(Boolean) as string[];
  const line = parts.join(" · ").replace(/^./, c => c.toUpperCase()) || "Nothing booked yet";
  return { line, tone: next?.tone === "amber" || visit?.status === "overdue" ? "amber" : "muted" };
}

/** A booking request the patient sent (care.bookings.list). */
export type BookingRequest = Awaited<ReturnType<AppRouterClient["care"]["bookings"]["list"]>>[number];
/**
 * The requests the Schedule shows, soonest first: ones still waiting for the care team, and declined
 * ones (with the care team's note) until the patient asks the same doctor again. Only times still
 * ahead; a confirmed one is already a visit.
 */
export function openRequests<T extends Pick<BookingRequest, "doctorId" | "startsAt" | "status" | "createdAt">>(list: T[], now: Date): T[] {
  return list.filter(r => new Date(r.startsAt) > now && (r.status === "requested"
    || (r.status === "declined" && !list.some(o => o.doctorId === r.doctorId && new Date(o.createdAt) > new Date(r.createdAt)))))
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}
