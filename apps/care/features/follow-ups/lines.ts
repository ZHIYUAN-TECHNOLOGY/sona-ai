import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { formatDate, tFor, type Lang } from "@/lib/i18n";
import { statusOf, type CheckIn } from "../check-ins/model";
import { clock, dueNow, isLate, untilLine, type DayDose } from "../doses/model";
import "./strings";

export type FollowUp = Awaited<ReturnType<AppRouterClient["care"]["followUps"]>>[number];

export const away = (n: number, lang: Lang = "en") => {
  const t = tFor(lang);
  return n === 0 ? t("when.today") : n === 1 ? t("when.tomorrow") : n === -1 ? t("when.yesterday") : n > 0 ? t("when.inDays", { n }) : t("when.daysAgo", { n: -n });
};
/** "Fri 25 Dec", the day in the hospital's time (Malaysia) whatever the phone says. */
export const dayLabel = (date: Date | string, lang: Lang = "en") => formatDate(lang, date, "day");
/** "Fri 25 Dec · in 90 days". */
export const whenLine = (f: Pick<FollowUp, "date" | "inDays">, lang: Lang = "en") => `${dayLabel(f.date, lang)} · ${away(f.inDays, lang)}`;

/** "10:30 AM" in Malaysia for a booked visit; a recall or the discharge review has a due day, not a time. */
export const timeLabel = (f: Pick<FollowUp, "id" | "date">, lang: Lang = "en") => f.id.startsWith("recall:") || f.id === "discharge-review" ? undefined
  : formatDate(lang, f.date, "time");
/** The visit card's pill: "Fri 25 Dec · 10:30 AM", or just the day. */
export const pillLine = (f: Pick<FollowUp, "id" | "date">, lang: Lang = "en") => [dayLabel(f.date, lang), timeLabel(f, lang)].filter(Boolean).join(" · ");
/** What to bring: paperwork only, since the data holds no preparation steps for a visit or test. */
export const bringLine = (f: Pick<FollowUp, "id">, lang: Lang = "en") => tFor(lang)(f.id === "discharge-review" ? "fu.bringReview" : "fu.bring");

/** The next visit: the earliest not yet attended (upcoming, due soon or missed), from the list earliest first. Home and Schedule both read this. */
export const nextVisit = <T extends Pick<FollowUp, "status">>(items: T[] | undefined) => items?.find(f => f.status !== "attended");

/** How many follow-ups need the patient now (due soon or missed); counts toward home's insight line. */
export const followUpNeeds = (items: Pick<FollowUp, "status">[] | undefined) => items?.filter(f => f.status === "due-soon" || f.status === "missed").length ?? 0;

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
export const longDay = (day: number, lang: Lang = "en") => formatDate(lang, civil(day), "long");
/** "Mon", "Isn", "周一" for a day number. */
export const weekdayOf = (day: number, lang: Lang = "en") => formatDate(lang, civil(day), "weekday");
/** The Monday-first week holding a day, as seven day numbers. */
export function weekAround(day: number): number[] {
  const monday = day - (civil(day).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => monday + i);
}
/** The week strip's head: "28 Sep – 4 Oct". */
export const weekLabel = (week: number[], lang: Lang = "en") => [week[0]!, week[6]!].map(d => formatDate(lang, civil(d), "dayMonth")).join(" – ");

/**
 * The dots under a day: a visit (missed kept apart), a check-in, and for past days of this week whether
 * every dose was marked taken. `week` is `weekOf`'s review, which ends today.
 */
export type DayMarks = { visit?: "due" | "missed"; checkIn?: true; doses?: "taken" | "missed" };
export function marksByDay(today: number, visits: Pick<FollowUp, "date" | "status">[], checkIns: Ask[], week: { state: string }[]) {
  const marks: Record<number, DayMarks> = {};
  const at = (day: number) => (marks[day] ??= {});
  for (const v of visits) { const m = at(dayOf(v.date)); if (m.visit !== "missed") m.visit = v.status === "missed" ? "missed" : "due"; }
  for (const c of checkIns) at(dayOf(c.dueAt)).checkIn = true;
  week.forEach(({ state }, i) => {
    const day = today - (week.length - 1 - i);
    if (day < today && (state === "all" || state === "some" || state === "none")) at(day).doses = state === "all" ? "taken" : "missed";
  });
  return marks;
}

/** A day chip's VoiceOver label: "Sunday 4 October, today, Clinic review, Day 7 check-in". */
export function dayA11y(day: number, today: number, visits: Visit[], checkIns: Ask[], marks: DayMarks = {}, lang: Lang = "en") {
  const t = tFor(lang);
  return [longDay(day, lang), day === today && t("fu.a11yToday"), ...visits.filter(v => dayOf(v.date) === day).map(v => v.short),
    ...checkIns.filter(c => dayOf(c.dueAt) === day).map(c => t("checkin.title", { day: c.day })),
    marks.doses && (marks.doses === "taken" ? t("fu.a11yAllTaken") : t("fu.a11ySomeMissed"))].filter(Boolean).join(", ");
}

/** The next visit or check-in after a day, for an empty day's jump. */
export function nextUp(after: number, visits: Visit[], checkIns: Ask[], lang: Lang = "en"): { day: number; title: string } | undefined {
  const t = tFor(lang);
  return [...visits.map(v => ({ day: dayOf(v.date), title: v.short })), ...checkIns.map(c => ({ day: dayOf(c.dueAt), title: t("checkin.title", { day: c.day }) }))]
    .filter(e => e.day > after).sort((a, b) => a.day - b.day)[0];
}

/** An empty day's line: "Nothing today · Next: Clinic review in 7 days". */
export const emptyLine = (day: number, today: number, next?: { day: number; title: string }, lang: Lang = "en") => {
  const t = tFor(lang);
  return [day === today ? t("fu.nothingToday") : t("fu.nothingThisDay"), next && t("fu.nextAway", { title: next.title, when: away(next.day - today, lang) })].filter(Boolean).join(" · ");
};

export type Tone = "muted" | "blue" | "amber" | "green";
/**
 * One stop on a day's timeline: its time (none for an all-day item), title, one line of state, whether
 * it is done, and at most one inline action: take the doses, answer the check-in, or read before the visit.
 * `soon` is how the insight line names it when it is next ("check-in at 9:00 AM").
 */
export type AgendaItem = { key: string; at?: Date; title: string; line: string; tone: Tone; done: boolean; action?: "take" | "answer" | "prepare"; soon: string; visit?: FollowUp };

const partOf = (at: Date) => { const h = new Date(at.getTime() + MYT).getUTCHours(); return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"; };

/**
 * A day's timeline, all-day items first, then by time: doses grouped by their time ("Morning medicines"),
 * check-ins, visits, and for a past day whether every dose was taken.
 */
export function agendaOf(now: Date, { visits, checkIns, doses, doseMark }: { visits: FollowUp[]; checkIns: CheckIn[]; doses: DayDose[]; doseMark?: DayMarks["doses"] }, lang: Lang = "en"): AgendaItem[] {
  const tr = tFor(lang);
  const slots = new Map<number, DayDose[]>();
  for (const d of doses) slots.set(d.dueAt.getTime(), [...slots.get(d.dueAt.getTime()) ?? [], d]);
  const items: AgendaItem[] = [
    ...[...slots].map(([t, group]): AgendaItem => {
      const at = new Date(t), done = group.every(d => d.taken), until = untilLine(at, now, lang), late = !done && isLate(at, now);
      const title = tr(`fu.meds.${partOf(at)}`), names = group.map(d => d.name).join(", "), what = title.toLowerCase();
      return { key: `doses@${t}`, at, title, done, line: done ? tr("fu.taken", { names }) : late ? `${until} · ${names}` : names, tone: done ? "green" : late ? "amber" : "muted",
        action: !done && dueNow(at, now) ? "take" : undefined, soon: late ? what : tr("fu.soonAt", { what, time: clock(at, lang) }) };
    }),
    ...checkIns.map((c): AgendaItem => {
      const s = statusOf(c, now, lang), at = new Date(c.dueAt), done = c.replies.length > 0, waiting = !done && s.tone === "blue";
      return { key: c.id, at, title: tr("checkin.title", { day: c.day }), line: s.line, tone: s.tone, done, action: waiting ? "answer" : undefined, soon: waiting ? tr("fu.soonCheckInWaiting") : tr("fu.soonCheckInAt", { time: clock(at, lang) }) };
    }),
    ...visits.map((f): AgendaItem => {
      const time = timeLabel(f, lang), overdue = f.status === "missed";
      return { key: f.id, at: time ? new Date(f.date) : undefined, title: f.title, line: overdue ? tr("fu.overdueDue", { when: away(f.inDays, lang) }) : f.why, tone: overdue ? "amber" : "muted", done: false,
        action: "prepare", soon: overdue ? tr("fu.soonVisitOverdue") : time && f.inDays === 0 ? tr("fu.soonVisitAt", { time }) : tr("fu.soonVisitWhen", { when: away(f.inDays, lang) }), visit: f };
    }),
  ];
  if (doseMark) items.push({ key: "doses", title: tr("fu.meds"), line: doseMark === "taken" ? tr("fu.allDosesTaken") : tr("fu.someMissed"), tone: doseMark === "taken" ? "green" : "amber", done: doseMark === "taken", soon: tr("fu.soonMeds") });
  return items.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
}

/**
 * Schedule's insight under the title, one short line: "Next: check-in at 9:00 AM · visit in 3 days". A late dose
 * is named without its lateness (its row carries the one amber "late" with Take now); amber only for a missed visit.
 */
export function scheduleLine(today: AgendaItem[], visits: Pick<FollowUp, "id" | "status" | "inDays">[], lang: Lang = "en"): { line: string; tone: "muted" | "amber" } {
  const t = tFor(lang), next = today.find(i => !i.done), visit = nextVisit(visits);
  const parts = [next ? t("fu.next", { what: next.soon }) : today.length ? t("fu.allDoneToday") : undefined,
    visit && visit.id !== next?.key && (visit.status === "missed" ? t("fu.soonVisitOverdue") : t("fu.soonVisitWhen", { when: away(visit.inDays, lang) }))].filter(Boolean) as string[];
  const line = parts.join(" · ").replace(/^./, c => c.toUpperCase()) || t("fu.nothingBooked");
  return { line, tone: visit?.status === "missed" ? "amber" : "muted" };
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
