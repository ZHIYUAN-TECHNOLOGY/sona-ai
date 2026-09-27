import { clock, early, type DayDose, type ScheduledMed, type WeekDay } from "./model";

const MYT = 8 * 3600_000, DAY = 86_400_000;
/** A dose counts as missed once it is 6 h late (as on home), and it is no longer offered to log. */
const GRACE = 6 * 3600_000;
const dayOf = (d: Date) => Math.floor((d.getTime() + MYT) / DAY);

export type StripDay = { key: number; weekday: string; date: string; today: boolean; mark?: "green" | "amber" };

/**
 * The medicine screen's 7-day strip (Life OS): up to 3 days back since discharge, today, then the days
 * ahead. Days so far carry a dot from `weekOf`: green when every dose was taken, amber when one was missed.
 */
export function weekStrip(week: WeekDay[], now: Date): StripDay[] {
  const today = dayOf(now), past = Math.min(Math.max(week.length - 1, 0), 3);
  return Array.from({ length: 7 }, (_, i) => {
    const day = today - past + i, state = week[week.length - 1 - past + i]?.state;
    const noon = new Date(day * DAY - MYT + 12 * 3600_000);
    const part = (o: Intl.DateTimeFormatOptions) => noon.toLocaleDateString("en-GB", { ...o, timeZone: "Asia/Kuala_Lumpur" });
    const mark = state === "all" && day <= today ? "green" : (state === "some" || state === "none") && day < today ? "amber" : undefined;
    return { key: day, weekday: part({ weekday: "short" }), date: part({ day: "numeric" }), today: day === today, mark };
  });
}

/** A checklist row's check: taken; `now` (within 2 h or late, so a hold logs it); `later`; `missed` (6 h late, never offered, so no double dose). */
export function checkState(d: DayDose, now: Date): "taken" | "now" | "later" | "missed" {
  if (d.taken) return "taken";
  if (d.dueAt.getTime() < now.getTime() - GRACE) return "missed";
  return early(d.dueAt, now) ? "later" : "now";
}

/** "1 tablet at 9:00 PM", with "· after food" when the take line says so; "At 9:00 PM" when it names no amount. */
export function doseLine(line: string, dueAt: Date) {
  const amount = /^\d+(\.\d+)?\s*(tablets?|capsules?|puffs?|drops?|ml|mg|g)\b/i.exec(line)?.[0];
  const food = foodOf(line);
  return `${amount ? `${amount} at` : "At"} ${clock(dueAt)}${food ? ` · ${food} food` : ""}`;
}

export type Prescription = { name: string; line: string; badge: string; tone: "amber" | "green" | "muted" };

/**
 * "Active prescriptions": each medicine on a timer, with what is left of a course (the plan's count less
 * the doses logged), or "Ongoing" when the plan gives no count.
 * ponytail: counts the phone's taken log, which keeps the last 40 doses; a server log keeps them all.
 */
export function prescriptions(meds: ScheduledMed[], taken: string[]): Prescription[] {
  return meds.filter(m => m.at?.length).map(m => {
    if (m.doses === undefined) return { name: m.name, line: m.line, badge: "Ongoing", tone: "muted" };
    const left = Math.max(0, m.doses - taken.filter(k => k.startsWith(`${m.name}@`)).length);
    return { name: m.name, line: m.line, badge: left ? `${left} left` : "Course done", tone: left ? "amber" : "green" };
  });
}

/** "before" or "after" when the take line says so ("1 tablet after food"); "with or without food" says neither. */
export const foodOf = (line: string) => /\b(before|after) (food|meals?)\b/i.exec(line)?.[1]?.toLowerCase() as "before" | "after" | undefined;
