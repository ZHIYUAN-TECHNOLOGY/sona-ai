import { clock, dosesToday, untilLine, whenWords, type ScheduledMed } from "./doses/model";

/** Days since the patient left hospital, counted on calendar days in the hospital's time zone (discharge day is day 0). */
export function daysHome(dischargedAt: string | undefined, now = new Date()) {
  if (!dischargedAt) return undefined;
  const day = (d: Date) => Math.floor((d.getTime() + 8 * 3600_000) / 86_400_000);
  return day(now) - day(new Date(dischargedAt));
}

/** The home title: where the patient is, with the part to glance at (the accent) first. */
export function whereWords(days: number | undefined): [accent: string, rest: string] {
  return days === undefined ? ["Your care", " between visits"] : days === 0 ? ["Home", " today"] : [`Day ${days}`, " at home"];
}

/** One open thing on home, shown as a chip under the title. */
export type Need = { kind: "dose" | "check-in" | "reply" | "visit"; label: string };

// Rough seconds each takes, so the line can say how long "needs you" really is.
const SECONDS: Record<Need["kind"], number> = { dose: 15, "check-in": 15, reply: 60, visit: 30 };

/** The line under the title: how many things need the patient and about how long; zero reads as reassurance. */
export function needsLine(needs: Pick<Need, "kind">[]) {
  if (!needs.length) return "All done for today";
  const mins = Math.max(1, Math.round(needs.reduce((s, n) => s + SECONDS[n.kind], 0) / 60));
  return `${needs.length} ${needs.length === 1 ? "thing needs" : "things need"} you · about ${mins} min`;
}

/**
 * The medicine card's kicker and big value: a live mm:ss while under an hour away ("ticking"), the
 * clock time when further off, and amber "Due now" / "20 min late" once it is due.
 */
export function countdown(dueAt: Date, now: Date): { kicker: string; value: string; due: boolean; ticking: boolean } {
  const ms = dueAt.getTime() - now.getTime();
  if (ms <= 0) {
    const late = untilLine(dueAt, now);
    return { kicker: late === "now" ? "Due now" : late[0]!.toUpperCase() + late.slice(1), value: clock(dueAt), due: true, ticking: false };
  }
  if (ms < 3600_000) {
    const s = Math.ceil(ms / 1000);
    return { kicker: "Next medicine in", value: `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`, due: ms <= 30 * 60_000, ticking: true };
  }
  const day = whenWords(dueAt, now).replace(` ${clock(dueAt)}`, "");
  return { kicker: day === "today" ? "Next medicine at" : `Next medicine ${day}`, value: clock(dueAt), due: false, ticking: false };
}

/** A dose counts as missed once it is 6 h late, when it stops being the next dose. */
const GRACE = 6 * 3600_000;
const weekday = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "Asia/Kuala_Lumpur" });

/** "This week"'s one line: every dose taken, or how many were missed and when (the last 7 days since discharge). */
export function weekLine(meds: ScheduledMed[], dischargedAt: string | undefined, taken: string[], now: Date): { text: string; tone: "green" | "amber" | "muted" } {
  const doses = Array.from({ length: 7 }, (_, i) => dosesToday(meds, dischargedAt, taken, new Date(now.getTime() - i * 86_400_000))).flat();
  const missed = doses.filter(d => !d.taken && d.dueAt.getTime() < now.getTime() - GRACE);
  if (!missed.length) return doses.some(d => d.dueAt <= now) ? { text: "Every dose taken", tone: "green" } : { text: doses.length ? "Nothing missed so far" : "Nothing on a timer this week", tone: "muted" };
  const days = [...new Set(missed.map(d => weekday(d.dueAt)))];
  const n = `${missed.length} ${missed.length === 1 ? "dose" : "doses"} missed`;
  return { text: days.length === 1 ? `${n} on ${days[0]}` : `${n} this week`, tone: "amber" };
}

/** "Check-ins: 1 of 2 answered", or nothing before any check-in exists. */
export const checkInsLine = (checkIns: { replies: unknown[] }[] | undefined) =>
  checkIns?.length ? `Check-ins: ${checkIns.filter(c => c.replies.length).length} of ${checkIns.length} answered` : undefined;
