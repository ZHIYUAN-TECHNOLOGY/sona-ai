/** A take-home medicine as the plan gives it: how to take one dose, daily times (Malaysia, "HH:MM") and, for a course, how many doses are left. */
export type ScheduledMed = { name: string; line: string; take?: string; at?: string[]; doses?: number };
export type Dose = { name: string; line: string; dueAt: Date; key: string };

const MYT = 8 * 3600_000, DAY = 86_400_000;
/** A missed dose stays the next one for this long, then the one after takes over. */
const GRACE = 6 * 3600_000;

/** Every dose of one medicine after the patient left hospital, up to `until`. */
function slots(med: ScheduledMed, out: Date, until: Date): Date[] {
  const all: Date[] = [];
  const first = Math.floor((out.getTime() + MYT) / DAY) * DAY - MYT; // midnight of discharge day, Malaysia time
  for (let day = first; day <= until.getTime(); day += DAY)
    for (const hhmm of med.at ?? []) {
      const [h, m] = hhmm.split(":").map(Number);
      const due = new Date(day + (h! * 60 + m!) * 60_000);
      if (due > out && due <= until) all.push(due);
    }
  return med.doses === undefined ? all : all.slice(0, med.doses);
}

export const doseKey = (name: string, dueAt: Date) => `${name}@${dueAt.toISOString()}`;

/** The dose to take next: the earliest one not yet taken, a missed one only while it is a few hours late. */
export function nextDose(meds: ScheduledMed[], dischargedAt: string | undefined, taken: string[], now: Date): Dose | undefined {
  if (!dischargedAt) return undefined;
  const out = new Date(dischargedAt), until = new Date(now.getTime() + 2 * DAY);
  return meds.flatMap(med => slots(med, out, until).map(dueAt => ({ name: med.name, line: med.take ?? med.line, dueAt, key: doseKey(med.name, dueAt) })))
    .filter(d => d.dueAt.getTime() > now.getTime() - GRACE && !taken.includes(d.key))
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())[0];
}

/** More than two hours before it is due: taking it now is early, so the screen asks quietly. */
export const early = (dueAt: Date, now: Date) => dueAt.getTime() - now.getTime() > 2 * 3600_000;

/** Due within half an hour, or late: it counts toward the home's "needs you". */
export const dueNow = (dueAt: Date, now: Date) => dueAt.getTime() - now.getTime() <= 30 * 60_000;

/** "9:00 PM", in the hospital's time whatever the phone says. */
export const clock = (date: Date) => date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }).replace(/\s/g, " "); // Hermes uses a narrow space

const span = (ms: number) => {
  const mins = Math.round(ms / 60_000), h = Math.floor(mins / 60), m = mins % 60;
  return [h && `${h} h`, m && `${m} min`].filter(Boolean).join(" ");
};
/** "in 2 h 10 min", "now" (within 5 minutes either side), "1 h 30 min late". */
export function untilLine(dueAt: Date, now: Date) {
  const ms = dueAt.getTime() - now.getTime();
  return Math.abs(ms) < 5 * 60_000 ? "now" : ms > 0 ? `in ${span(ms)}` : `${span(-ms)} late`;
}

/** "today 10:00 PM", "tomorrow 8:00 AM", else "Tue 29 Sep 8:00 AM", in Malaysia time. */
export function whenWords(dueAt: Date, now: Date) {
  const day = (d: Date) => Math.floor((d.getTime() + MYT) / DAY);
  const ahead = day(dueAt) - day(now);
  const date = ahead === 0 ? "today" : ahead === 1 ? "tomorrow"
    : dueAt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur" }).replace(",", "");
  return `${date} ${clock(dueAt)}`;
}

export type DayDose = Dose & { taken: boolean };
const dayOf = (d: Date) => Math.floor((d.getTime() + MYT) / DAY);

/** Every scheduled dose on the same Malaysia day as `now`, earliest first, each marked taken or not (the medicine screen's today strip). */
export function dosesToday(meds: ScheduledMed[], dischargedAt: string | undefined, taken: string[], now: Date): DayDose[] {
  if (!dischargedAt) return [];
  const out = new Date(dischargedAt), today = dayOf(now), end = new Date((today + 1) * DAY - MYT - 1);
  return meds.flatMap(med => slots(med, out, end).filter(d => dayOf(d) === today)
    .map(dueAt => ({ name: med.name, line: med.take ?? med.line, dueAt, key: doseKey(med.name, dueAt), taken: taken.includes(doseKey(med.name, dueAt)) })))
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

export type WeekDay = { label: string; state: "all" | "some" | "none" | "ahead" | "free" };

/**
 * Home's "this week" review: one entry per day from discharge day (at most the last 7), whether every
 * dose that was due that day is marked taken. "ahead": doses still to come today and none missed yet;
 * "free": nothing scheduled that day.
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
    return { label, state };
  });
}
