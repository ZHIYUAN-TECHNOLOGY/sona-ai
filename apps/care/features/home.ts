import { clock, dosesToday, untilLine, whenWords, type ScheduledMed } from "./doses/model";
import { REPLY_TIME, type Message } from "./messages/model";

/** Days since the patient left hospital, counted on calendar days in the hospital's time zone (discharge day is day 0). */
export function daysHome(dischargedAt: string | undefined, now = new Date()) {
  if (!dischargedAt) return undefined;
  const day = (d: Date) => Math.floor((d.getTime() + 8 * 3600_000) / 86_400_000);
  return day(now) - day(new Date(dischargedAt));
}

/** The header's date, "Sun, 27 Sep", in the hospital's time whatever the phone says. */
export const headerDate = (now: Date) =>
  now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur" }).replace(",", "").replace(" ", ", ");

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

/** The medicine card's pill: "Next in 18:34" in the last hour, "Next 9:00 PM", "Tomorrow 8:00 AM", or "Due now · 9:00 PM" (amber) once due. */
export function nextLine(dueAt: Date, now: Date): { text: string; due: boolean; ticking: boolean } {
  const c = countdown(dueAt, now);
  const late = dueAt.getTime() <= now.getTime();
  return { text: late ? `${c.kicker} · ${c.value}` : c.kicker.startsWith("Next medicine tomorrow") ? `Tomorrow ${c.value}` : `${c.kicker.replace(/^Next medicine( at)?/, "Next")} ${c.value}`, due: c.due, ticking: c.ticking };
}

/**
 * Consistency: the share of doses taken, of those due over the same days as the week bars (discharge
 * day, or at most the last 7). A dose counts once taken or 6 h late; undefined while nothing is due yet.
 * ponytail: 7 days, not all since discharge, as the phone keeps only the last 40 taken doses; widen with a server log.
 */
export function consistency(meds: ScheduledMed[], dischargedAt: string | undefined, taken: string[], now: Date) {
  const due = Array.from({ length: 7 }, (_, i) => dosesToday(meds, dischargedAt, taken, new Date(now.getTime() - i * 86_400_000))).flat()
    .filter(d => d.taken || d.dueAt.getTime() < now.getTime() - GRACE);
  return due.length ? Math.round(due.filter(d => d.taken).length / due.length * 100) : undefined;
}

/** "Latest update": a waiting reply's words first, then a sent message's status, else reassurance (green). */
export function latestLine(messages: Pick<Message, "from" | "text">[] | undefined, unread: boolean, calm: boolean): { lead?: string; text: string; tone: "ink" | "muted" | "green" } {
  const last = messages?.at(-1);
  if (unread && last) return { lead: "Care team replied", text: last.text, tone: "ink" };
  if (last?.from === "patient") return { lead: "Message sent", text: REPLY_TIME, tone: "muted" };
  return { text: calm ? "✦ Nothing needs you" : "✦ No new messages", tone: "green" };
}
