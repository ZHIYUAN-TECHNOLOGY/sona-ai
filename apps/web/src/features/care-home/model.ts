import { doseKey, doseSlots, type ScheduledMed } from "@sona-ai/domain/doses";

export type Lang = "en" | "ms" | "zh";

/** The browser's language as one the server speaks; English otherwise. */
export const langOf = (tag: string | undefined): Lang => (tag?.startsWith("ms") ? "ms" : tag?.startsWith("zh") ? "zh" : "en");

const MYT = 8 * 3600_000, DAY = 86_400_000;
const dayOf = (d: Date) => Math.floor((d.getTime() + MYT) / DAY);

export type DayDose = { name: string; line: string; dueAt: Date; key: string; taken: boolean };

/** Today's doses (the day in Malaysia), earliest first: the same rule as the phone app's `dosesToday`. */
export function dosesToday(meds: ScheduledMed[], dischargedAt: string | undefined, taken: string[], now: Date): DayDose[] {
  if (!dischargedAt) return [];
  const out = new Date(dischargedAt), today = dayOf(now), end = new Date((today + 1) * DAY - MYT - 1);
  return meds
    .flatMap(med => doseSlots(med, out, end).filter(d => dayOf(d) === today).map(dueAt => {
      const key = doseKey(med.name, dueAt);
      return { name: med.name, line: med.take ?? med.line, dueAt, key, taken: taken.includes(key) };
    }))
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

type CheckIn = { replies: unknown[]; sentAt?: Date | string | null; dueAt: Date };
type Visit = { title: string; date: Date; inDays: number };

export type NextStep<C extends CheckIn, V extends Visit> =
  | { kind: "dose"; dose: DayDose }
  | { kind: "check-in"; checkIn: C }
  | { kind: "visit"; visit: V }
  | { kind: "none" };

/** The one thing to do next: a dose due within 30 minutes or overdue, else a check-in waiting, else the next visit. */
export function nextStep<C extends CheckIn, V extends Visit>(doses: DayDose[], checkIns: C[], visits: V[], now: Date): NextStep<C, V> {
  const dose = doses.find(d => !d.taken && d.dueAt.getTime() - now.getTime() <= 30 * 60_000);
  if (dose) return { kind: "dose", dose };
  const checkIn = checkIns.find(c => !c.replies.length && (c.sentAt || c.dueAt <= now));
  if (checkIn) return { kind: "check-in", checkIn };
  const visit = visits.find(v => v.inDays >= 0);
  return visit ? { kind: "visit", visit } : { kind: "none" };
}

/** "today", "tomorrow", "in 5 days". */
export const inDaysWords = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);
