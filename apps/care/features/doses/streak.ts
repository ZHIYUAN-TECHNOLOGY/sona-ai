import { dosesToday, type ScheduledMed } from "./model";

const MYT = 8 * 3600_000, DAY = 86_400_000, GRACE = 6 * 3600_000;
const dayOf = (t: number) => Math.floor((t + MYT) / DAY);

/**
 * Days in a row, back from today to discharge day, with every due dose taken. A day still in progress
 * (a dose to come, or late but within 6 h) neither counts nor breaks it; a missed dose breaks it; a day
 * with nothing due is skipped.
 * ponytail: the phone keeps the last 40 taken doses, so a very long streak undercounts; a server log fixes it.
 */
export function streak(meds: ScheduledMed[], dischargedAt: string | undefined, taken: string[], now: Date) {
  if (!dischargedAt) return 0;
  let n = 0;
  for (let k = 0; dayOf(now.getTime()) - k >= dayOf(new Date(dischargedAt).getTime()); k++) {
    const due = dosesToday(meds, dischargedAt, taken, new Date(now.getTime() - k * DAY));
    if (!due.length) continue;
    if (due.every(d => d.taken)) n++;
    else if (due.some(d => !d.taken && d.dueAt.getTime() < now.getTime() - GRACE)) break;
  }
  return n;
}

/** "5 day streak 🔥"; under two days, "Day 1 · keep going". */
export const streakLine = (n: number) => n < 2 ? "Day 1 · keep going" : `${n} day streak 🔥`;
