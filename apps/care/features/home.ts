import { todayOf, type CheckIn } from "./check-ins/model";
import { clock, dosesToday, dueNow, untilLine, whenWords, type ScheduledMed, type WeekDay } from "./doses/model";
import { now as clockNow } from "@/lib/clock";

const MYT = 8 * 3600_000, DAY = 86_400_000;
const dayOf = (d: Date) => Math.floor((d.getTime() + MYT) / DAY);

/** Days since the patient left hospital, counted on calendar days in the hospital's time zone (discharge day is day 0). */
export function daysHome(dischargedAt: string | undefined, now = clockNow()) {
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

const lastWeek = (meds: ScheduledMed[], dischargedAt: string | undefined, taken: string[], now: Date) =>
  Array.from({ length: 7 }, (_, i) => dosesToday(meds, dischargedAt, taken, new Date(now.getTime() - i * DAY))).flat();
const missedBy = (d: { taken: boolean; dueAt: Date }, now: Date) => !d.taken && d.dueAt.getTime() < now.getTime() - GRACE;

/** "This week"'s one line: every dose taken, or how many were missed and when (the last 7 days since discharge). */
export function weekLine(meds: ScheduledMed[], dischargedAt: string | undefined, taken: string[], now: Date): { text: string; tone: "green" | "amber" | "muted" } {
  const doses = lastWeek(meds, dischargedAt, taken, now), missed = doses.filter(d => missedBy(d, now));
  if (!missed.length) return doses.some(d => d.dueAt <= now) ? { text: "Every dose taken", tone: "green" } : { text: doses.length ? "Nothing missed so far" : "Nothing on a timer this week", tone: "muted" };
  const days = [...new Set(missed.map(d => weekday(d.dueAt)))];
  const n = `${missed.length} ${missed.length === 1 ? "dose" : "doses"} missed`;
  return { text: days.length === 1 ? `${n} on ${days[0]}` : `${n} this week`, tone: "amber" };
}

/**
 * Home's Consistency tile: the share of the last 7 days' doses taken, counting only doses taken or
 * missed (6 h late), so one still to come never lowers it. Undefined until a dose has counted.
 */
export function consistency(meds: ScheduledMed[], dischargedAt: string | undefined, taken: string[], now: Date) {
  const doses = lastWeek(meds, dischargedAt, taken, now), done = doses.filter(d => d.taken).length, missed = doses.filter(d => missedBy(d, now)).length;
  return done + missed ? Math.round(done / (done + missed) * 100) : undefined;
}

/** The medicines tile's capsule while the next dose is over 2 h off: "Next at 9:00 PM", "Tomorrow 8:00 AM", "Tue 29 Sep 8:00 AM". */
export function nextCapsule(dueAt: Date, now: Date) {
  const when = whenWords(dueAt, now);
  return when.startsWith("today ") ? `Next at ${clock(dueAt)}` : cap(when);
}

/** Home's header date, "Sun, 27 Sep", in the hospital's time. */
export function headerDate(now: Date) {
  const part = (o: Intl.DateTimeFormatOptions) => now.toLocaleDateString("en-GB", { ...o, timeZone: "Asia/Kuala_Lumpur" });
  return `${part({ weekday: "short" })}, ${part({ day: "numeric" })} ${part({ month: "short" })}`;
}

export type Update = { line: string; tone: "green" | "amber" | "blue" | "muted"; face: "smile" | "calm" | "chat"; to: "messages" | "check-in" | "check-ins" | "follow-ups" };

/**
 * Home's Latest update tile, the newest thing about the patient's recovery: a care-team reply waiting,
 * today's check-in answered (all fine, or the team told) or waiting, else nothing new.
 */
export function latestUpdate(checkIns: Pick<CheckIn, "dueAt" | "sentAt" | "replies">[] | undefined, replyWaiting: boolean, now: Date, bookedIn?: string): Update {
  if (replyWaiting) return { line: "Care team replied", tone: "blue", face: "chat", to: "messages" };
  // The doctor answered her check-in by booking her in: that is the news, ahead of "they'll call you".
  if (bookedIn) return { line: `Your doctor booked you in · ${bookedIn}`, tone: "blue", face: "smile", to: "follow-ups" };
  const today = checkIns?.flatMap(c => c.replies).filter(r => dayOf(new Date(r.receivedAt)) === dayOf(now)).at(-1);
  if (today) return today.label === "fine"
    ? { line: "Check-in done · all fine", tone: "green", face: "smile", to: "check-ins" }
    : { line: "Check-in sent · they'll call you", tone: "amber", face: "calm", to: "check-ins" };
  if (checkIns && todayOf(checkIns as CheckIn[], now).ask) return { line: "Your check-in is waiting", tone: "blue", face: "calm", to: "check-in" };
  return { line: "Nothing new today", tone: "muted", face: "smile", to: "messages" };
}

/** The water log's daily goal (logged from the + sheet on home). */
export const GLASSES = 8;

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
