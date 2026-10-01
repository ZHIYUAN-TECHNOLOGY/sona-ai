import { ORPCError } from "@orpc/server";
import { appointments, careMessages, checkInReplies, checkIns, doctors, encounters, findings, patients, pushTokens, tasks } from "@sona-ai/db/schema/clinical";
import { ACT_WITHIN_MS, decideFollowUp, type FollowUp } from "@sona-ai/domain/check-in-agent";
import { checkInMessage, checkInSchedule, reasonOf, replyFlag, type CheckIn } from "@sona-ai/domain/check-ins";
import type { DischargeState, Language } from "@sona-ai/domain/discharge";
import { shortName } from "@sona-ai/domain/doctors";
import { draftByRules } from "@sona-ai/domain/messages";
import { and, asc, eq, gte, inArray, isNull, like, lte, or } from "drizzle-orm";
import { z } from "zod";

import { clockOffsetOf } from "../clock";
import { clockOf, type Context } from "../context";
import { checkInReplySchema, type CheckInReply } from "../contracts";
import type { Change } from "../events";
import { protectedProcedure } from "../index";
import { stubModels } from "../models";
import { followUpsToAdd } from "./findings";
import { tellPatient } from "../push";
import { captureSample } from "./training";

/**
 * Demo flow 7: after-discharge check-ins through a simulated inbox (no real message leaves). A
 * discharge schedules them and starts the visit's check-in agent (Sona's follow-up), which sends each
 * one when due, asks again once if there is no reply, and acts on each reply as the model seam read
 * it: worse or urgent replies become one task for the attending doctor. The hourly cron wakes every
 * agent as a backstop; without agents (tests) it sends due check-ins directly.
 */

/** Called by discharge.request with the chosen days; IDs are per encounter and day, so a replayed discharge schedules nothing new. */
export async function scheduleCheckIns(db: Context["db"], hospitalId: string, patient: { id: string; name: string }, encounterId: string, language: Language, dischargedAt: Date, days?: number[]) {
  const first = patient.name.split(" ")[0]!;
  await db.insert(checkIns).values(checkInSchedule(dischargedAt, days).map(({ day, dueAt }) => ({
    id: `check-in:${encounterId}:${day}`, hospitalId, patientId: patient.id, encounterId, day, language, message: checkInMessage(first, language), dueAt,
  }))).onConflictDoNothing();
}

/**
 * The send itself (a visit's check-in agent, or wakeFollowUps without agents): every due, unsent check-in,
 * of one visit when `encounterId` is given, is marked sent to the simulated inbox, and each patient's phones
 * get one push for their latest day. `fetch` is the push's outbound HTTP (tests pass a fake; the Worker uses the global one).
 */
export async function sendDueCheckIns(db: Context["db"], hospitalId: string, now: Date, fetch?: Context["fetch"], encounterId?: string) {
  const sent = await db.update(checkIns).set({ sentAt: now })
    .where(and(eq(checkIns.hospitalId, hospitalId), encounterId ? eq(checkIns.encounterId, encounterId) : undefined, isNull(checkIns.sentAt), lte(checkIns.dueAt, now)))
    .returning({ id: checkIns.id, patientId: checkIns.patientId, day: checkIns.day });
  const latest = new Map<string, number>();
  for (const s of sent) latest.set(s.patientId, Math.max(s.day, latest.get(s.patientId) ?? 0));
  await Promise.all([...latest].map(([patientId, day]) => tellPatient({ db, fetch }, hospitalId, patientId, { kind: "check-in", day })));
  return { sent: sent.length, patientIds: [...latest.keys()] };
}

/** A hospital's check-ins with their replies, for one visit or (Sona Care) one patient when given. */
export async function listCheckIns(db: Context["db"], hospitalId: string, { encounterId, patientId }: { encounterId?: string; patientId?: string } = {}): Promise<CheckIn[]> {
  const rows = await db.select({
    id: checkIns.id, patientId: checkIns.patientId, encounterId: checkIns.encounterId, day: checkIns.day, language: checkIns.language,
    message: checkIns.message, dueAt: checkIns.dueAt, sentAt: checkIns.sentAt,
  }).from(checkIns).where(and(eq(checkIns.hospitalId, hospitalId), encounterId ? eq(checkIns.encounterId, encounterId) : undefined, patientId ? eq(checkIns.patientId, patientId) : undefined))
    .orderBy(asc(checkIns.dueAt));
  if (!rows.length) return [];
  const replies = await db.select({ checkInId: checkInReplies.checkInId, reply: checkInReplies, task: tasks }).from(checkInReplies)
    .leftJoin(tasks, eq(tasks.id, checkInReplies.taskId))
    .where(inArray(checkInReplies.checkInId, rows.map(r => r.id))).orderBy(asc(checkInReplies.receivedAt));
  return rows.map(r => ({ ...r, replies: replies.filter(x => x.checkInId === r.id).map(({ reply, task }) => ({
    id: reply.id, text: reply.text, label: reply.label, source: reply.source, receivedAt: reply.receivedAt,
    task: task && { id: task.id, title: task.title, completed: task.completed },
  })) }));
}

/** The author of the agent's messages in a patient's thread: Sona, not a person (the care team's view shows "Care team"). */
const SONA_AUTHOR = "sona";

/**
 * One wake of a visit's check-in agent (apps/server/src/agents/check-in.ts; tests run it in memory). On the
 * hospital's clock it sends what is due through the usual path (Sona Care and a push), then does what
 * decideFollowUp says: ask again, bring the next check-in forward, or tell an urgent patient to call 999
 * (the existing template, in her thread and as a push). `wakeAt` is real time, so the agent's alarm is right
 * whatever the demo clock says; a jump moves it by waking the agent again. A visit that is not discharged
 * (or no longer is, after a demo reset) has nothing to follow.
 */
export async function runFollowUp(context: Pick<Context, "db" | "fetch" | "announce" | "now">, hospitalId: string, encounterId: string, before?: FollowUp) {
  const { db } = context;
  const offset = await clockOffsetOf(db, hospitalId);
  const now = new Date(clockOf(context).getTime() + offset);
  const [row] = await db.select({ state: encounters.state, patientId: patients.id, name: patients.name }).from(encounters)
    .innerJoin(patients, eq(patients.id, encounters.patientId)).where(and(eq(encounters.id, encounterId), eq(encounters.hospitalId, hospitalId)));
  const discharge = (row?.state as { discharge?: DischargeState } | undefined)?.discharge;
  if (!row || !discharge?.dischargedAt) return { followUp: null, sent: 0 };
  const { sent } = await sendDueCheckIns(db, hospitalId, now, context.fetch, encounterId);
  const rows = await listCheckIns(db, hospitalId, { encounterId });
  if (!rows.length) return { followUp: null, sent };
  const patient = { id: row.patientId, name: row.name };
  const visit = { hospitalId, encounterId, patientId: patient.id, dischargedAt: new Date(discharge.dischargedAt) };
  const [phone] = await db.select({ token: pushTokens.token }).from(pushTokens).where(and(eq(pushTokens.hospitalId, hospitalId), eq(pushTokens.patientId, patient.id))).limit(1);
  const decision = decideFollowUp(before, visit, rows, now, Boolean(phone));

  if (decision.reask) await tellPatient(context, hospitalId, patient.id, { kind: "reask", day: decision.reask.day });
  if (decision.bringForward) await scheduleCheckIns(db, hospitalId, patient, encounterId, discharge.language, visit.dischargedAt, [decision.bringForward.day]);
  for (const { replyId, language } of decision.call999) {
    const text = draftByRules({ text: "", label: "urgent", patientFirstName: patient.name.split(" ")[0]!, language });
    // Keyed by the reply, so a replayed wake tells her once.
    const [told] = await db.insert(careMessages).values({ id: `message:${patient.id}:call-999:${replyId}`, hospitalId, patientId: patient.id, from: "care-team", authorId: SONA_AUTHOR, text, createdAt: now })
      .onConflictDoNothing().returning({ id: careMessages.id });
    if (told) await tellPatient(context, hospitalId, patient.id, { kind: "call-999", text });
  }
  // What it did shows at once: Sona Pro re-reads My Day and the check-ins, her Sona Care re-reads too.
  const announce = (change: Change) => context.announce?.(hospitalId, change).catch(() => {});
  if (sent || decision.reask || decision.bringForward || decision.call999.length) await announce({ topic: "checkIns", encounterId, patientId: patient.id });
  if (decision.call999.length) await announce({ topic: "messages", patientId: patient.id });
  return { followUp: decision.followUp, sent, wakeAt: decision.wakeAt && new Date(decision.wakeAt.getTime() - offset) };
}

/**
 * The hourly cron's backstop, a demo jump and checkIns.tick: every visit still being followed at this
 * hospital wakes its agent, which acts on what is due by the hospital's clock. An agent that fails never
 * holds a check-in back (that visit's are sent directly), and without agents (tests) all due ones are.
 */
export async function wakeFollowUps(context: Pick<Context, "db" | "fetch" | "followUps">, hospitalId: string, now: Date) {
  const { db, followUps } = context;
  if (!followUps) return sendDueCheckIns(db, hospitalId, now, context.fetch);
  // Still followed: a check-in to send, or one sent in the last day that may need asking again.
  // ponytail: wakes them all at once; batch the calls if a hospital ever follows thousands of visits.
  const visits = await db.selectDistinct({ encounterId: checkIns.encounterId, patientId: checkIns.patientId }).from(checkIns)
    .where(and(eq(checkIns.hospitalId, hospitalId), or(isNull(checkIns.sentAt), gte(checkIns.sentAt, new Date(now.getTime() - ACT_WITHIN_MS)))));
  const woken = await Promise.all(visits.map(async v => {
    try {
      return { ...v, sent: (await followUps.tick(hospitalId, v.encounterId)).sent };
    } catch (error) {
      console.error("check-in agent failed", v.encounterId, error);
      return { ...v, sent: (await sendDueCheckIns(db, hospitalId, now, context.fetch, v.encounterId)).sent };
    }
  }));
  const patientIds = [...new Set(woken.filter(v => v.sent).map(v => v.patientId))];
  return { sent: woken.reduce((n, v) => n + v.sent, 0), patientIds };
}

export const checkInsRouter = {
  list: protectedProcedure.input(z.object({ encounterId: z.string().min(1).optional() }).optional())
    .handler(({ context: { db, hospitalId }, input }) => listCheckIns(db, hospitalId, { encounterId: input?.encounterId })),
  /** Sends what is due now (the demo does not wait for the hourly cron): every followed visit's agent acts. */
  tick: protectedProcedure.handler(({ context }) => wakeFollowUps(context, context.hospitalId, clockOf(context))),
  /**
   * Sona's follow-up for one visit: what its check-in agent did and why, and what it does next. Null before
   * the agent's first wake (or without agents). The visit must be this hospital's.
   */
  followUp: protectedProcedure.input(z.object({ encounterId: z.string().min(1) })).handler(async ({ context, input }) => {
    const [visit] = await context.db.select({ id: encounters.id }).from(encounters).where(and(eq(encounters.id, input.encounterId), eq(encounters.hospitalId, context.hospitalId)));
    if (!visit) throw new ORPCError("NOT_FOUND", { message: `No visit ${input.encounterId}` });
    const followUp = await context.followUps?.get(context.hospitalId, visit.id);
    return followUp ? { timeline: followUp.timeline, next: followUp.next } : null;
  }),
  /** The simulated patient reply. Replying to an unsent check-in sends it first, since the demo jumps two days. */
  reply: protectedProcedure.input(checkInReplySchema).handler(({ context, input }) => replyToCheckIn(context, context.hospitalId, input)),
  /**
   * "Book in" on a flagged reply: books the patient's clinic review at `startsAt` (a slot the doctor
   * picked, in the next 30 days; tomorrow 09:00 Kuala Lumpur by default) with `doctorId` when given,
   * closes the flag, and tells her Sona Care, whose Schedule and home then show it. The appointment is
   * keyed by the task: replaying returns the same booking, a new time moves it (and any test already
   * put on the same trip moves with it). `toAdd` lists her X-ray findings that still need a follow-up,
   * so the doctor can put the test on the same trip.
   */
  bookIn: protectedProcedure.input(z.object({ taskId: z.string().min(1), startsAt: z.coerce.date().optional(), doctorId: z.string().min(1).optional() })).handler(async ({ context, input }) => {
    const { db, hospitalId } = context, now = clockOf(context);
    const [row] = await db.select({ task: tasks, patientId: encounters.patientId }).from(tasks).innerJoin(encounters, eq(encounters.id, tasks.encounterId))
      .where(and(eq(tasks.id, input.taskId), eq(tasks.hospitalId, hospitalId), eq(tasks.kind, "check-in")));
    if (!row) throw new ORPCError("NOT_FOUND", { message: "That flagged reply is no longer open" });
    if (input.startsAt && (input.startsAt <= now || input.startsAt.getTime() > now.getTime() + 30 * 86_400_000))
      throw new ORPCError("BAD_REQUEST", { message: "Choose a time in the next 30 days" });
    const [doctor] = input.doctorId ? await db.select({ name: doctors.name }).from(doctors).where(and(eq(doctors.id, input.doctorId), eq(doctors.hospitalId, hospitalId))) : [];
    if (input.doctorId && !doctor) throw new ORPCError("NOT_FOUND", { message: "No such doctor at this hospital" });
    const id = `book-in:${row.task.id}`;
    const [before] = await db.select({ startsAt: appointments.startsAt, kind: appointments.kind, doctorId: appointments.doctorId }).from(appointments).where(eq(appointments.id, id));
    const kind = doctor ? `Clinic review · ${reasonOf(row.task.title)} · ${shortName(doctor.name)}` : before?.kind ?? `Clinic review · ${reasonOf(row.task.title)}`;
    const startsAt = input.startsAt ?? before?.startsAt ?? tomorrowNine(now);
    // The doctor holds the slot (bookings.withSlots); a replay without one keeps the doctor it had.
    const doctorId = input.doctorId ?? before?.doctorId ?? null;
    await db.insert(appointments).values({ id, patientId: row.patientId, hospitalId, doctorId, startsAt, kind, bookedAt: now })
      .onConflictDoUpdate({ target: appointments.id, set: { startsAt, kind, doctorId } });
    // Moved: tests put on the same trip (their recalls at the old time) move with it.
    if (before && before.startsAt.getTime() !== startsAt.getTime()) {
      const riders = await db.update(appointments).set({ startsAt })
        .where(and(eq(appointments.patientId, row.patientId), eq(appointments.hospitalId, hospitalId), eq(appointments.startsAt, before.startsAt), like(appointments.id, "recall:%")))
        .returning({ id: appointments.id });
      if (riders.length) await db.update(findings).set({ dueAt: startsAt }).where(inArray(findings.id, riders.map(r => r.id.replace(/^recall:/, ""))));
    }
    await db.update(tasks).set({ completed: true }).where(eq(tasks.id, row.task.id));
    const [booked] = await db.select().from(appointments).where(eq(appointments.id, id));
    // The hospital hears "checkIns" from the middleware; her own app hears it here, by name.
    await context.announce?.(hospitalId, { topic: "checkIns", patientId: row.patientId }).catch(() => {});
    await tellPatient(context, hospitalId, row.patientId, { kind: "booked", at: booked!.startsAt });
    // Anything from her X-ray still needing a follow-up can ride on the same visit (findings.addToVisit).
    const toAdd = await followUpsToAdd(context, hospitalId, row.patientId, booked!.startsAt);
    return { appointmentId: booked!.id, startsAt: booked!.startsAt, kind: booked!.kind, patientId: row.patientId, toAdd };
  }),
};

/** 09:00 tomorrow in Kuala Lumpur (UTC+8), from `now`. */
export function tomorrowNine(now: Date) {
  const local = new Date(now.getTime() + 8 * 3600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, 1));
}

/** What the booking is for, in the patient's words (shared with the check-in agent's timeline). */
export { reasonOf };

/**
 * A reply as the model reads it; worse or urgent flags one task for the attending doctor. Sona Care
 * passes `patientId` so a patient can only answer their own check-in (anything else is NOT_FOUND).
 */
export async function replyToCheckIn(context: Context, hospitalId: string, input: CheckInReply, patientId?: string) {
  const { db } = context;
  const [row] = await db.select({ checkIn: checkIns, name: patients.name }).from(checkIns).innerJoin(patients, eq(patients.id, checkIns.patientId))
    .where(and(eq(checkIns.id, input.checkInId), eq(checkIns.hospitalId, hospitalId), patientId ? eq(checkIns.patientId, patientId) : undefined));
  if (!row) throw new ORPCError("NOT_FOUND", { message: `No check-in ${input.checkInId}`, data: { code: "CHECK_IN_UNKNOWN" } });
  const at = clockOf(context);
  await db.update(checkIns).set({ sentAt: at }).where(and(eq(checkIns.id, row.checkIn.id), isNull(checkIns.sentAt)));
  const read = await (context.models ?? stubModels).classifyReply({ text: input.text, language: row.checkIn.language });
  const id = crypto.randomUUID();
  const flag = replyFlag(row.name.split(" ")[0]!, read.label, input.text, read.symptom);
  if (flag) await db.insert(tasks).values({
    id, hospitalId, encounterId: row.checkIn.encounterId, kind: "check-in", title: flag.title, owner: "Attending doctor", due: "Today",
    sourceId: id, idempotencyKey: `check-in:${id}`,
  }).onConflictDoNothing();
  await db.insert(checkInReplies).values({
    id, checkInId: row.checkIn.id, text: input.text, label: read.label, source: read.source === "model" ? read.model : "fixture", taskId: flag ? id : null, receivedAt: at,
  });
  // The reply and how it was read become a de-identified training sample (if consented); never fails the reply.
  await captureSample(context, { id: `check-in-reply:${id}`, hospitalId, patientId: row.checkIn.patientId, source: "check-in-reply", sourceRef: row.checkIn.id, input: input.text, output: read.label });
  // The visit's agent acts on it now: worse brings the next check-in forward, urgent tells her to call 999.
  // A failed wake never fails the reply; the agent reads it on its next wake.
  await context.followUps?.tick(hospitalId, row.checkIn.encounterId).catch(error => console.error("check-in agent failed", error));
  return (await listCheckIns(db, hospitalId, { encounterId: row.checkIn.encounterId })).find(c => c.id === row.checkIn.id)!;
}
