import { formatDate, tFor, type Lang } from "@/lib/i18n";
import { clock, early, isLate, untilLine, type DayDose, type WeekDay } from "./model";
import "./strings";

const MYT = 8 * 3600_000, DAY = 86_400_000;
/** A dose counts as missed once it is 6 h late (as on home), and it is no longer offered to log. */
const GRACE = 6 * 3600_000;
const dayOf = (d: Date) => Math.floor((d.getTime() + MYT) / DAY);

export type StripDay = { key: number; weekday: string; narrow: string; date: string; today: boolean; mark?: "green" | "amber" } & Partial<Omit<WeekDay, "label">>;

/**
 * The medicine screen's 7-day strip: up to 3 days back since discharge, today, then the days ahead.
 * Days so far carry a dot from `weekOf` (green when every dose was taken, amber when one was missed)
 * and its state and counts; days ahead have none. Home asks for the days so far only (`back` 6, `length` the week's).
 */
export function weekStrip(week: WeekDay[], now: Date, lang: Lang = "en", back = 3, length = 7): StripDay[] {
  const today = dayOf(now), past = Math.min(Math.max(week.length - 1, 0), back);
  return Array.from({ length }, (_, i) => {
    const day = today - past + i, { state, done, due } = week[week.length - 1 - past + i] ?? {} as Partial<WeekDay>;
    const noon = new Date(day * DAY - MYT + 12 * 3600_000);
    const mark = state === "all" && day <= today ? "green" : (state === "some" || state === "none") && day < today ? "amber" : undefined;
    return { key: day, weekday: formatDate(lang, noon, "weekday"), narrow: formatDate(lang, noon, "narrow"), state, done, due, date: String(new Date(noon.getTime() + MYT).getUTCDate()), today: day === today, mark };
  });
}

/** A bar's one line: "Tue · 3 of 4 taken", "Today · 1 of 3 so far", "Thu · nothing due", "Fri · still to come". */
export function dayLine(d: StripDay, lang: Lang = "en") {
  const t = tFor(lang), day = d.today ? t("dose.weekToday") : d.weekday, n = { day, done: d.done ?? 0, due: d.due ?? 0 };
  return d.due === undefined ? t("dose.dayAhead", n) : !d.due ? t("dose.dayFree", n) : t(d.today && n.done < d.due ? "dose.daySoFar" : "dose.dayTaken", n);
}
/** The chart read out as one line: "This week. Mon 4 of 4 taken; Tue nothing due; Today 1 of 3 so far" (days ahead left out). */
export const weekSaid = (days: StripDay[], lang: Lang = "en") =>
  tFor(lang)("dose.week", { days: days.filter(d => d.due !== undefined).map(d => dayLine(d, lang).replace(" · ", " ")).join("; ") });

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
