import { ORPCError } from "@orpc/server";
import { checkInReplies, checkIns, patients, tasks } from "@sona-ai/db/schema/clinical";
import { checkInMessage, checkInSchedule, replyFlag, type CheckIn } from "@sona-ai/domain/check-ins";
import type { Language } from "@sona-ai/domain/discharge";
import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import { z } from "zod";

import { clockOf, type Context } from "../context";
import { checkInReplySchema, type CheckInReply } from "../contracts";
import { protectedProcedure } from "../index";
import { stubModels } from "../models";

/**
 * Demo flow 7: after-discharge check-ins through a simulated inbox (no real message leaves). A
 * discharge schedules them, the hourly cron marks due ones sent, and a patient's reply is read by
 * the model seam; worse or urgent replies become one task for the attending doctor.
 */

/** Called by discharge.request; IDs are per encounter and day, so a replayed discharge schedules nothing new. */
export async function scheduleCheckIns(db: Context["db"], hospitalId: string, patient: { id: string; name: string }, encounterId: string, language: Language, dischargedAt: Date) {
  const first = patient.name.split(" ")[0]!;
  await db.insert(checkIns).values(checkInSchedule(dischargedAt).map(({ day, dueAt }) => ({
    id: `check-in:${encounterId}:${day}`, hospitalId, patientId: patient.id, encounterId, day, language, message: checkInMessage(first, language), dueAt,
  }))).onConflictDoNothing();
}

/** The Worker's hourly cron (and checkIns.tick): every due, unsent check-in is marked sent to the simulated inbox. */
export async function sendDueCheckIns(db: Context["db"], hospitalId: string, now: Date) {
  const sent = await db.update(checkIns).set({ sentAt: now })
    .where(and(eq(checkIns.hospitalId, hospitalId), isNull(checkIns.sentAt), lte(checkIns.dueAt, now))).returning({ id: checkIns.id });
  return { sent: sent.length };
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

export const checkInsRouter = {
  list: protectedProcedure.input(z.object({ encounterId: z.string().min(1).optional() }).optional())
    .handler(({ context: { db, hospitalId }, input }) => listCheckIns(db, hospitalId, { encounterId: input?.encounterId })),
  /** Sends what is due now (the demo does not wait for the hourly cron). */
  tick: protectedProcedure.handler(({ context }) => sendDueCheckIns(context.db, context.hospitalId, clockOf(context))),
  /** The simulated patient reply. Replying to an unsent check-in sends it first, since the demo jumps two days. */
  reply: protectedProcedure.input(checkInReplySchema).handler(({ context, input }) => replyToCheckIn(context, context.hospitalId, input)),
};

/**
 * A reply as the model reads it; worse or urgent flags one task for the attending doctor. Sona Care
 * passes `patientId` so a patient can only answer their own check-in (anything else is NOT_FOUND).
 */
export async function replyToCheckIn(context: Context, hospitalId: string, input: CheckInReply, patientId?: string) {
  const { db } = context;
  const [row] = await db.select({ checkIn: checkIns, name: patients.name }).from(checkIns).innerJoin(patients, eq(patients.id, checkIns.patientId))
    .where(and(eq(checkIns.id, input.checkInId), eq(checkIns.hospitalId, hospitalId), patientId ? eq(checkIns.patientId, patientId) : undefined));
  if (!row) throw new ORPCError("NOT_FOUND", { message: `No check-in ${input.checkInId}` });
  const at = clockOf(context);
  await db.update(checkIns).set({ sentAt: at }).where(and(eq(checkIns.id, row.checkIn.id), isNull(checkIns.sentAt)));
  const read = await (context.models ?? stubModels).classifyReply({ text: input.text, language: row.checkIn.language });
  const id = crypto.randomUUID();
  const flag = replyFlag(row.name.split(" ")[0]!, read.label, input.text);
  if (flag) await db.insert(tasks).values({
    id, hospitalId, encounterId: row.checkIn.encounterId, kind: "check-in", title: flag.title, owner: "Attending doctor", due: "Today",
    sourceId: id, idempotencyKey: `check-in:${id}`,
  }).onConflictDoNothing();
  await db.insert(checkInReplies).values({
    id, checkInId: row.checkIn.id, text: input.text, label: read.label, source: read.source === "model" ? read.model : "fixture", taskId: flag ? id : null, receivedAt: at,
  });
  return (await listCheckIns(db, hospitalId, { encounterId: row.checkIn.encounterId })).find(c => c.id === row.checkIn.id)!;
}
