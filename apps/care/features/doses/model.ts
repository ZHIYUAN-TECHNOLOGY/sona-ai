import { doseKey, doseSlots as slots, MISSED_AFTER as GRACE, parseDoseKey, type ScheduledMed } from "@sona-ai/domain/doses";
import { formatDate, tFor, type Lang } from "@/lib/i18n";
import "@/lib/strings";

// The schedule itself (slots, keys, the missed window) is shared with the server in @sona-ai/domain/doses.
export { doseKey, type ScheduledMed };
export type Dose = { name: string; line: string; dueAt: Date; key: string };

const MYT = 8 * 3600_000, DAY = 86_400_000;

/** The dose to take next: the earliest one not yet taken, a missed one only while it is a few hours late. */
export function nextDose(meds: ScheduledMed[], dischargedAt: string | undefined, taken: string[], now: Date): Dose | undefined {
  if (!dischargedAt) return undefined;
  const out = new Date(dischargedAt), until = new Date(now.getTime() + 2 * DAY);
  return meds.flatMap(med => slots(med, out, until).map(dueAt => ({ name: med.name, line: med.take ?? med.line, dueAt, key: doseKey(med.name, dueAt) })))
    .filter(d => d.dueAt.getTime() > now.getTime() - GRACE && !taken.includes(d.key))
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())[0];
}

/** The dose a reminder opened (its key), while it is in the plan and not yet taken; else undefined. */
export function doseOf(meds: ScheduledMed[], key: string | undefined, taken: string[]): Dose | undefined {
  const parsed = key && !taken.includes(key) ? parseDoseKey(key) : undefined;
  const med = parsed && meds.find(m => m.name === parsed.name && m.at?.length);
  return med && parsed ? { name: med.name, line: med.take ?? med.line, dueAt: parsed.dueAt, key: doseKey(med.name, parsed.dueAt) } : undefined;
}

/** More than two hours before it is due: taking it now is early, so the screen asks quietly. */
export const early = (dueAt: Date, now: Date) => dueAt.getTime() - now.getTime() > 2 * 3600_000;

/** Due within half an hour, or late: it counts toward the home's "needs you". */
export const dueNow = (dueAt: Date, now: Date) => dueAt.getTime() - now.getTime() <= 30 * 60_000;

/** "9:00 PM" ("9:00 PTG", "晚上9:00"), in the hospital's time whatever the phone says. */
export const clock = (date: Date, lang: Lang = "en") => formatDate(lang, date, "time");

const span = (ms: number, lang: Lang) => {
  const t = tFor(lang), mins = Math.round(ms / 60_000), h = Math.floor(mins / 60), m = mins % 60;
  return [h && t("time.h", { n: h }), m && t("time.min", { n: m })].filter(Boolean).join(lang === "zh" ? "" : " ");
};
/** Within 5 minutes either side of the due time. */
export const isNow = (dueAt: Date, now: Date) => Math.abs(dueAt.getTime() - now.getTime()) < 5 * 60_000;
/** 5 minutes or more past the due time. */
export const isLate = (dueAt: Date, now: Date) => now.getTime() - dueAt.getTime() >= 5 * 60_000;
/** "in 2 h 10 min", "now" (within 5 minutes either side), "1 h 30 min late". */
export function untilLine(dueAt: Date, now: Date, lang: Lang = "en") {
  const ms = dueAt.getTime() - now.getTime(), t = tFor(lang);
  return isNow(dueAt, now) ? t("time.now") : ms > 0 ? t("time.in", { span: span(ms, lang) }) : t("time.late", { span: span(-ms, lang) });
}

export type DayDose = Dose & { taken: boolean };
const dayOf = (d: Date) => Math.floor((d.getTime() + MYT) / DAY);

/** "today", "tomorrow", else "Tue 29 Sep", in Malaysia time. */
export function dayWord(dueAt: Date, now: Date, lang: Lang = "en") {
  const ahead = dayOf(dueAt) - dayOf(now), t = tFor(lang);
  return ahead === 0 ? t("when.today") : ahead === 1 ? t("when.tomorrow") : formatDate(lang, dueAt, "day");
}
/** "today 10:00 PM", "tomorrow 8:00 AM", else "Tue 29 Sep 8:00 AM", in Malaysia time. */
export function whenWords(dueAt: Date, now: Date, lang: Lang = "en") {
  const ahead = dayOf(dueAt) - dayOf(now), t = tFor(lang), time = clock(dueAt, lang);
  return ahead === 0 ? t("when.todayAt", { time }) : ahead === 1 ? t("when.tomorrowAt", { time }) : formatDate(lang, dueAt, "dayTime");
}

/** Every scheduled dose on the same Malaysia day as `now`, earliest first, each marked taken or not (the medicine screen's today strip). */
export function dosesToday(meds: ScheduledMed[], dischargedAt: string | undefined, taken: string[], now: Date): DayDose[] {
  if (!dischargedAt) return [];
  const out = new Date(dischargedAt), today = dayOf(now), end = new Date((today + 1) * DAY - MYT - 1);
  return meds.flatMap(med => slots(med, out, end).filter(d => dayOf(d) === today)
    .map(dueAt => ({ name: med.name, line: med.take ?? med.line, dueAt, key: doseKey(med.name, dueAt), taken: taken.includes(doseKey(med.name, dueAt)) })))
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

export type WeekDay = { label: string; state: "all" | "some" | "none" | "ahead" | "free"; done: number; due: number };

/**
 * Home's "this week" review: one entry per day from discharge day (at most the last 7), whether every
 * dose that was due that day is marked taken, and how many (`done` of `due`, for the bar charts).
 * "ahead": doses still to come today and none missed yet; "free": nothing scheduled that day.
 */
export function weekOf(meds: ScheduledMed[], dischargedAt: string | undefined, taken: string[], now: Date): WeekDay[] {
  if (!dischargedAt) return [];
  const out = new Date(dischargedAt), today = dayOf(now), first = Math.max(dayOf(out), today - 6);
  const all = meds.flatMap(med => slots(med, out, new Date((today + 1) * DAY - MYT - 1)).map(dueAt => ({ day: dayOf(dueAt), dueAt, key: doseKey(med.name, dueAt) })));
  return Array.from({ length: today - first + 1 }, (_, i) => {
    const day = first + i, due = all.filter(d => d.day === day), done = due.filter(d => taken.includes(d.key)).length;
    const label = new Date(day * DAY - MYT + 12 * 3600_000).toLocaleDateString("en-GB", { weekday: "narrow", timeZone: "Asia/Kuala_Lumpur" });
    const pastDue = due.filter(d => d.dueAt <= now && !taken.includes(d.key)).length;
    const state = !due.length ? "free" : done === due.length ? "all" : day === today && !pastDue ? (done ? "some" : "ahead") : done ? "some" : "none";
    return { label, state, done, due: due.length };
  });
}
