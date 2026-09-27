import { todayOf, type CheckIn } from "./check-ins/model";
import { clock, dosesToday, dueNow, untilLine, whenWords, type ScheduledMed, type WeekDay } from "./doses/model";
import { away } from "./follow-ups/lines";

const MYT = 8 * 3600_000, DAY = 86_400_000;
const dayOf = (d: Date) => Math.floor((d.getTime() + MYT) / DAY);

/** Days since the patient left hospital, counted on calendar days in the hospital's time zone (discharge day is day 0). */
export function daysHome(dischargedAt: string | undefined, now = new Date()) {
  if (!dischargedAt) return undefined;
  return dayOf(now) - dayOf(new Date(dischargedAt));
}

/** One open thing on home, shown as a chip under the headline; a dose carries its medicine, a visit how far off it is. */
export type Need = { kind: "dose" | "check-in" | "reply" | "visit"; label: string; name?: string; inDays?: number; overdue?: boolean };

// Rough seconds each takes, so the line can say how long "needs you" really is.
const SECONDS: Record<Need["kind"], number> = { dose: 15, "check-in": 15, reply: 60, visit: 30 };

/** How many things need the patient and about how long (the bell's spoken label); zero reads as reassurance. */
export function needsLine(needs: Pick<Need, "kind">[]) {
  if (!needs.length) return "All done for today";
  const mins = Math.max(1, Math.round(needs.reduce((s, n) => s + SECONDS[n.kind], 0) / 60));
  return `${needs.length} ${needs.length === 1 ? "thing needs" : "things need"} you · about ${mins} min`;
}

/**
 * Home's big status line: the most urgent open thing in words (a dose due, an overdue visit, today's
 * check-in, a waiting reply, a visit coming up), else "Positive today".
 */
export function headline(needs: Omit<Need, "label">[]) {
  const dose = needs.find(n => n.kind === "dose");
  if (dose) return `Time for ${dose.name}`;
  if (needs.some(n => n.kind === "visit" && n.overdue)) return "Visit overdue";
  if (needs.some(n => n.kind === "check-in")) return "Check in today";
  if (needs.some(n => n.kind === "reply")) return "Care team replied";
  const visit = needs.find(n => n.kind === "visit");
  return visit ? `Visit ${away(visit.inDays ?? 0)}` : "Positive today";
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** The next-dose card's line under its time: "In 2 h 10 min", "Tomorrow", amber "Due in 18 min", "Due now" or "20 min late". */
export function doseStatus(dueAt: Date, now: Date): { text: string; tone: "amber" | "muted" } {
  const until = untilLine(dueAt, now), day = whenWords(dueAt, now).replace(` ${clock(dueAt)}`, "");
  if (dueAt <= now || until === "now") return { text: until === "now" ? "Due now" : cap(until), tone: "amber" };
  if (dueNow(dueAt, now)) return { text: `Due ${until}`, tone: "amber" };
  return { text: day === "today" ? cap(until) : cap(day), tone: "muted" };
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

/** Today's check-in: "done" once one was answered today, "pending" while one waits, else none today. */
export function checkInToday(checkIns: Pick<CheckIn, "dueAt" | "sentAt" | "replies">[], now: Date): "done" | "pending" | undefined {
  if (todayOf(checkIns as CheckIn[], now).ask) return "pending";
  return checkIns.some(c => c.replies.some(r => dayOf(new Date(r.receivedAt)) === dayOf(now))) ? "done" : undefined;
}

export const GLASSES = 8;
export type Part = { key: "medicines" | "check-in" | "water" | "visits"; label: string; share?: number; note: string };

/**
 * "Recovery today": four parts from the patient's own data only (doses taken of today's, today's
 * check-in, glasses logged of 8, the next visit booked and not overdue). A part with nothing today has
 * no share and is left out of the %. `next` is the part furthest behind, where a tap on the card goes.
 */
export function recovery({ doses, checkIn, glasses, visit }: { doses: { taken: boolean }[]; checkIn?: "done" | "pending"; glasses: number; visit?: { inDays: number; overdue: boolean } }) {
  const taken = doses.filter(d => d.taken).length, cups = Math.min(glasses, GLASSES);
  const parts: Part[] = [
    doses.length ? { key: "medicines", label: "Medicines", share: taken / doses.length, note: `${taken} of ${doses.length} taken` } : { key: "medicines", label: "Medicines", note: "None due today" },
    checkIn ? { key: "check-in", label: "Check-in", share: checkIn === "done" ? 1 : 0, note: checkIn === "done" ? "Done" : "Waiting" } : { key: "check-in", label: "Check-in", note: "None today" },
    { key: "water", label: "Water", share: cups / GLASSES, note: `${cups} of ${GLASSES} glasses` },
    visit ? { key: "visits", label: "Visits", share: visit.overdue ? 0 : 1, note: visit.overdue ? "Overdue" : `Booked · ${away(visit.inDays)}` } : { key: "visits", label: "Visits", note: "None booked" },
  ];
  const counted = parts.filter(p => p.share !== undefined);
  const pct = Math.round(counted.reduce((s, p) => s + p.share!, 0) / counted.length * 100);
  const next = counted.filter(p => p.share! < 1).sort((a, b) => a.share! - b.share!)[0]?.key;
  return { parts, pct, next };
}

// A day's dose state as a height on the sparkline; still to come or nothing due leaves no point.
const LEVEL: Partial<Record<WeekDay["state"], number>> = { all: 1, some: 0.5, none: 0 };

/** The next-dose card's 7-day sparkline as an SVG path through the days that had doses due, or undefined under two points. */
export function sparkPath(week: WeekDay[], width: number, height: number, pad = 3) {
  const step = week.length > 1 ? (width - pad * 2) / (week.length - 1) : 0;
  const pts = week.flatMap((d, i) => {
    const level = LEVEL[d.state];
    return level === undefined ? [] : [`${+(pad + i * step).toFixed(1)} ${+(pad + (1 - level) * (height - pad * 2)).toFixed(1)}`];
  });
  return pts.length < 2 ? undefined : `M${pts.join(" L")}`;
}
