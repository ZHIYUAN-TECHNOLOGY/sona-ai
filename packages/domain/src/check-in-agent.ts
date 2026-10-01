import { malaysianDay } from "./care";
import { checkInDaysLine, checkInSchedule, reasonOf, type CheckIn, type ReplyLabel } from "./check-ins";
import type { Language } from "./discharge";

/**
 * Sona's follow-up after discharge: what the check-in agent decides (apps/server/src/agents/check-in.ts
 * runs one per discharged visit). Pure, so it is tested without Cloudflare: from what the agent remembers
 * and the visit's check-ins as the database has them now, it says what to do and logs why.
 *
 * AI proposes, rules verify, the clinician decides: each reply arrives already read (Gemma, with the
 * keyword rule's urgent words as the floor), and worse or urgent replies are already tasks for the care
 * team. The agent only asks again once, brings the next check-in forward, and tells an urgent patient to
 * call 999 with the existing template; it never writes anything clinical of its own.
 */

/** A sent check-in with no reply is asked again once, after this long on the hospital's clock. */
export const REASK_AFTER_MS = 2 * 3600_000;
/** Replies and silences older than this are history: logged, never acted on (no 999 message a day late). */
export const ACT_WITHIN_MS = 24 * 3600_000;
// ponytail: keeps the latest entries only; store the full trail elsewhere if a visit ever needs it all.
const KEEP_ENTRIES = 40;

/** Colour carries meaning: red urgent, amber worse, green fine; routine steps stay neutral. */
export type FollowUpTone = "neutral" | "green" | "amber" | "red";
export type FollowUpEntry = { at: string; text: string; tone: FollowUpTone };

/** The agent's own state: who it follows, the schedule as it last read it, and every decision with why. */
export type FollowUp = {
  hospitalId: string; encounterId: string; patientId: string; dischargedAt: string;
  schedule: { id: string; day: number; dueAt: string; sentAt: string | null; reaskedAt: string | null; replies: { id: string; label: ReplyLabel; at: string }[] }[];
  timeline: FollowUpEntry[];
  /** What it does next and when (its alarm), or null once nothing is left to do. */
  next: { at: string; text: string } | null;
};

export type FollowedVisit = { hospitalId: string; encounterId: string; patientId: string; dischargedAt: Date };

export type FollowUpDecision = {
  followUp: FollowUp;
  /** The latest sent check-in, asked again with a gentle push. */
  reask?: { checkInId: string; day: number };
  /** After a worse reply: a check-in added tomorrow, when none is due by then. */
  bringForward?: { day: number; dueAt: Date };
  /** Urgent replies whose patient is told to call 999 now, in the check-in's language. */
  call999: { replyId: string; language: Language }[];
  /** When to wake next, on the hospital's clock; none once nothing is left. */
  wakeAt?: Date;
};

const iso = (at: Date | string | number) => new Date(at).toISOString();
const time = (at: Date | string) => new Date(at).getTime();

/**
 * One wake of the agent. `before` is what it remembered (none, or another discharge's, starts afresh);
 * `checkIns` are the visit's rows after anything due was sent; `now` is the hospital's (demo) clock.
 * `hasPhone`: asking again is a push, so without a registered phone the timeline says it could not.
 */
export function decideFollowUp(before: FollowUp | undefined, visit: FollowedVisit, checkIns: CheckIn[], now: Date, hasPhone = true): FollowUpDecision {
  const dischargedAt = iso(visit.dischargedAt);
  // A new discharge of the same visit (a demo run after a reset) starts a new follow-up.
  const same = before?.dischargedAt === dischargedAt;
  const known = same ? before!.schedule : [];
  const was = (id: string) => known.find(s => s.id === id);
  const rows = [...checkIns].sort((a, b) => time(a.dueAt) - time(b.dueAt));
  const entries: FollowUpEntry[] = [];
  const log = (at: Date | string, text: string, tone: FollowUpTone = "neutral") => entries.push({ at: iso(at), text, tone });
  if (!same) log(visit.dischargedAt, `Following up: check-ins on ${checkInDaysLine(rows.map(c => c.day))}`);

  // Discharge day is day 0, counted on calendar days in Kuala Lumpur like the schedule.
  const dayOf = (at: Date) => malaysianDay(at) - malaysianDay(visit.dischargedAt);
  const today = dayOf(now);
  const inWords = (day: number) => (day === today ? "today" : day === today + 1 ? "tomorrow" : `on day ${day}`);
  const recent = (at: Date | string) => time(now) - time(at) < ACT_WITHIN_MS;

  for (const c of rows) if (c.sentAt && !was(c.id)?.sentAt) log(c.sentAt, `Sent day-${c.day} check-in`);

  let bringForward: FollowUpDecision["bringForward"];
  const call999: FollowUpDecision["call999"] = [];
  const nextDay = () => Math.min(...rows.filter(c => !c.sentAt).map(c => c.day), bringForward?.day ?? Infinity);
  const read = new Set(known.flatMap(s => s.replies.map(r => r.id)));
  const replies = rows.flatMap(c => c.replies.filter(r => !read.has(r.id)).map(r => ({ ...r, checkIn: c })))
    .sort((a, b) => time(a.receivedAt) - time(b.receivedAt));
  for (const r of replies) {
    if (r.label === "fine") {
      const next = nextDay();
      log(r.receivedAt, `Reply read as fine; ${next === Infinity ? "no more check-ins planned" : `next check-in ${inWords(next)}`}`, "green");
      continue;
    }
    const symptom = r.task ? reasonOf(r.task.title) : "feeling worse";
    const act = recent(r.receivedAt);
    if (r.label === "urgent") {
      if (act) call999.push({ replyId: r.id, language: r.checkIn.language });
      log(r.receivedAt, `Reply read as urgent: ${symptom}; ${act ? "told to call 999 now; " : ""}urgent task for the care team`, "red");
      continue;
    }
    // Worse: look again tomorrow rather than wait for the next planned day.
    const tomorrow = today + 1;
    if (act && nextDay() > tomorrow && !rows.some(c => c.day === tomorrow))
      bringForward = { day: tomorrow, dueAt: checkInSchedule(visit.dischargedAt, [tomorrow])[0]!.dueAt };
    log(r.receivedAt, `Reply read as worse: ${symptom}; task for the care team${act ? `; next check-in ${inWords(Math.min(nextDay(), tomorrow))}` : ""}`, "amber");
  }

  // Only the latest check-in is asked again: an older one was overtaken by the one sent after it.
  const latest = rows.filter(c => c.sentAt).sort((a, b) => time(b.sentAt!) - time(a.sentAt!) || b.day - a.day)[0];
  const silent = latest && !latest.replies.length && !was(latest.id)?.reaskedAt ? time(now) - time(latest.sentAt!) : undefined;
  let reask: FollowUpDecision["reask"];
  if (silent !== undefined && silent >= REASK_AFTER_MS && silent < ACT_WITHIN_MS) {
    reask = { checkInId: latest!.id, day: latest!.day };
    log(now, `No reply after ${Math.floor(silent / 3600_000)} h; ${hasPhone ? "asked again" : "no phone registered to ask again"}`);
  }

  const schedule: FollowUp["schedule"] = rows.map(c => ({
    id: c.id, day: c.day, dueAt: iso(c.dueAt), sentAt: c.sentAt && iso(c.sentAt),
    reaskedAt: c.id === reask?.checkInId ? iso(now) : was(c.id)?.reaskedAt ?? null,
    replies: c.replies.map(r => ({ id: r.id, label: r.label, at: iso(r.receivedAt) })),
  }));
  if (bringForward) schedule.push({ id: `check-in:${visit.encounterId}:${bringForward.day}`, day: bringForward.day, dueAt: iso(bringForward.dueAt), sentAt: null, reaskedAt: null, replies: [] });

  // Next: the earliest unsent check-in, or asking again if the latest is still unanswered.
  const plans = schedule.filter(s => !s.sentAt).map(s => ({ at: s.dueAt, text: `Day-${s.day} check-in` }));
  if (silent !== undefined && silent < REASK_AFTER_MS) plans.push({ at: iso(time(latest!.sentAt!) + REASK_AFTER_MS), text: "Ask again if no reply" });
  const next = plans.sort((a, b) => time(a.at) - time(b.at))[0] ?? null;

  const timeline = [...(same ? before!.timeline : []), ...entries].sort((a, b) => time(a.at) - time(b.at)).slice(-KEEP_ENTRIES);
  return {
    followUp: { hospitalId: visit.hospitalId, encounterId: visit.encounterId, patientId: visit.patientId, dischargedAt, schedule, timeline, next },
    reask, bringForward, call999,
    wakeAt: next ? new Date(next.at) : undefined,
  };
}
