import { todayOf, type CheckIn } from "./check-ins/model";
import { clock, dayWord, dosesToday, dueNow, isNow, untilLine, whenWords, type ScheduledMed, type WeekDay } from "./doses/model";
import { now as clockNow } from "@/lib/clock";
import { formatDate, tFor, type Lang } from "@/lib/i18n";
import "./home/strings";

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
export function needsLine(needs: Pick<Need, "kind">[], lang: Lang = "en") {
  const t = tFor(lang);
  if (!needs.length) return t("home.allDone");
  const m = Math.max(1, Math.round(needs.reduce((s, n) => s + SECONDS[n.kind], 0) / 60));
  return t(needs.length === 1 ? "home.needs1" : "home.needsN", { n: needs.length, m });
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** The next-dose card's line under its time: "In 2 h 10 min", "Tomorrow", amber "Due in 18 min", "Due now" or "20 min late". */
export function doseStatus(dueAt: Date, now: Date, lang: Lang = "en"): { text: string; tone: "amber" | "muted" } {
  const t = tFor(lang), until = untilLine(dueAt, now, lang);
  if (dueAt <= now || isNow(dueAt, now)) return { text: isNow(dueAt, now) ? t("home.dueNow") : cap(until), tone: "amber" };
  if (dueNow(dueAt, now)) return { text: t("home.dueIn", { until }), tone: "amber" };
  return { text: dayOf(dueAt) === dayOf(now) ? cap(until) : cap(dayWord(dueAt, now, lang)), tone: "muted" };
}

/** A dose counts as missed once it is 6 h late, when it stops being the next dose. */
const GRACE = 6 * 3600_000;

const lastWeek = (meds: ScheduledMed[], dischargedAt: string | undefined, taken: string[], now: Date) =>
  Array.from({ length: 7 }, (_, i) => dosesToday(meds, dischargedAt, taken, new Date(now.getTime() - i * DAY))).flat();
const missedBy = (d: { taken: boolean; dueAt: Date }, now: Date) => !d.taken && d.dueAt.getTime() < now.getTime() - GRACE;

/** "This week"'s one line: every dose taken, or how many were missed and when (the last 7 days since discharge). */
export function weekLine(meds: ScheduledMed[], dischargedAt: string | undefined, taken: string[], now: Date, lang: Lang = "en"): { text: string; tone: "green" | "amber" | "muted" } {
  const t = tFor(lang), doses = lastWeek(meds, dischargedAt, taken, now), missed = doses.filter(d => missedBy(d, now));
  if (!missed.length) return doses.some(d => d.dueAt <= now) ? { text: t("home.everyDose"), tone: "green" } : { text: t(doses.length ? "home.nothingMissed" : "home.noTimerWeek"), tone: "muted" };
  const days = [...new Set(missed.map(d => formatDate(lang, d.dueAt, "weekday")))], n = missed.length;
  return { text: days.length === 1 ? t(n === 1 ? "home.missed1On" : "home.missedNOn", { n, day: days[0]! }) : t("home.missedNWeek", { n }), tone: "amber" };
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
export function nextCapsule(dueAt: Date, now: Date, lang: Lang = "en") {
  return dayOf(dueAt) === dayOf(now) ? tFor(lang)("home.nextAt", { time: clock(dueAt, lang) }) : cap(whenWords(dueAt, now, lang));
}

/** Home's header date, "Sun, 27 Sep", in the hospital's time. */
export const headerDate = (now: Date, lang: Lang = "en") => formatDate(lang, now, "header");

export type Update = { line: string; tone: "green" | "amber" | "blue" | "muted"; face: "smile" | "calm" | "chat"; to: "messages" | "check-in" | "check-ins" | "follow-ups" };

/**
 * Home's Latest update tile, the newest thing about the patient's recovery: a care-team reply waiting,
 * today's check-in answered (all fine, or the team told) or waiting, else nothing new.
 */
export function latestUpdate(checkIns: Pick<CheckIn, "dueAt" | "sentAt" | "replies">[] | undefined, replyWaiting: boolean, now: Date, bookedIn?: string, withTest?: string, lang: Lang = "en"): Update {
  const t = tFor(lang);
  if (replyWaiting) return { line: t("home.teamReplied"), tone: "blue", face: "chat", to: "messages" };
  // The doctor answered her check-in by booking her in: that is the news, ahead of "they'll call you".
  if (bookedIn) return { line: withTest ? t("home.bookedInTest", { when: bookedIn, test: withTest }) : t("home.bookedIn", { when: bookedIn }), tone: "blue", face: "smile", to: "follow-ups" };
  const today = checkIns?.flatMap(c => c.replies).filter(r => dayOf(new Date(r.receivedAt)) === dayOf(now)).at(-1);
  if (today) return today.label === "fine"
    ? { line: t("home.checkInFine"), tone: "green", face: "smile", to: "check-ins" }
    : { line: t("home.checkInSent"), tone: "amber", face: "calm", to: "check-ins" };
  if (checkIns && todayOf(checkIns as CheckIn[], now).ask) return { line: t("home.checkInWaiting"), tone: "blue", face: "calm", to: "check-in" };
  return { line: t("home.nothingNew"), tone: "muted", face: "smile", to: "messages" };
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
