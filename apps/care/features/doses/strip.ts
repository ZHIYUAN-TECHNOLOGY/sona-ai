import { formatDate, tFor, type Lang } from "@/lib/i18n";
import { clock, early, isLate, untilLine, type DayDose, type WeekDay } from "./model";
import "./strings";

const MYT = 8 * 3600_000, DAY = 86_400_000;
/** A dose counts as missed once it is 6 h late (as on home), and it is no longer offered to log. */
const GRACE = 6 * 3600_000;
const dayOf = (d: Date) => Math.floor((d.getTime() + MYT) / DAY);

export type StripDay = { key: number; weekday: string; date: string; today: boolean; mark?: "green" | "amber" };

/**
 * The medicine screen's 7-day strip: up to 3 days back since discharge, today, then the days ahead.
 * Days so far carry a dot from `weekOf`: green when every dose was taken, amber when one was missed.
 */
export function weekStrip(week: WeekDay[], now: Date, lang: Lang = "en"): StripDay[] {
  const today = dayOf(now), past = Math.min(Math.max(week.length - 1, 0), 3);
  return Array.from({ length: 7 }, (_, i) => {
    const day = today - past + i, state = week[week.length - 1 - past + i]?.state;
    const noon = new Date(day * DAY - MYT + 12 * 3600_000);
    const mark = state === "all" && day <= today ? "green" : (state === "some" || state === "none") && day < today ? "amber" : undefined;
    return { key: day, weekday: formatDate(lang, noon, "weekday"), date: String(new Date(noon.getTime() + MYT).getUTCDate()), today: day === today, mark };
  });
}

/** A dose's state: taken; `now` (within 2 h or late, so a hold logs it); `later`; `missed` (6 h late, never offered, so no double dose). */
export function checkState(d: DayDose, now: Date): "taken" | "now" | "later" | "missed" {
  if (d.taken) return "taken";
  if (d.dueAt.getTime() < now.getTime() - GRACE) return "missed";
  return early(d.dueAt, now) ? "later" : "now";
}

/**
 * The Medicine tab's one-line insight on today: a late dose first (amber), then "All taken today"
 * (green), else how many are taken, any missed, and the next time today.
 */
export function insight(today: DayDose[], now: Date, lang: Lang = "en"): { text: string; tone: "muted" | "amber" | "green" } {
  const t = tFor(lang);
  if (!today.length) return { text: t("dose.nothingToday"), tone: "muted" };
  const state = today.map(d => checkState(d, now));
  const at = state.findIndex(s => s === "now" || s === "later"), up = today[at];
  if (up && state[at] === "now" && isLate(up.dueAt, now)) return { text: t("dose.isLate", { name: up.name, late: untilLine(up.dueAt, now, lang) }), tone: "amber" };
  const count = state.filter(s => s === "taken").length, missed = state.filter(s => s === "missed").length;
  if (count === today.length) return { text: t("dose.allTaken"), tone: "green" };
  return { text: [t("dose.countTaken", { n: count, of: today.length }), missed && t("dose.missed", { n: missed }), up && t("dose.nextAt", { time: clock(up.dueAt, lang) })].filter(Boolean).join(" · "), tone: missed ? "amber" : "muted" };
}

/** "before" or "after" when the take line says so ("1 tablet after food"); "with or without food" says neither. */
export const foodOf = (line: string) => /\b(before|after) (food|meals?)\b/i.exec(line)?.[1]?.toLowerCase() as "before" | "after" | undefined;
