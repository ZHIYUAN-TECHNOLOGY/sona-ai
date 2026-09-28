import { ORPCError } from "@orpc/server";
import { careMessages, encounters, patients, tasks } from "@sona-ai/db/schema/clinical";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { clockOf, type Context } from "../context";
import { patientProcedure, protectedProcedure } from "../index";
import { tellPatient } from "../push";

/**
 * Sona Care messages: a plain thread between a patient and their care team. Each patient message is
 * one task for the attending doctor (on their visit, so it shows on My Day); the doctor's reply
 * closes those tasks. Both sides are replay-safe by requestId. Not for emergencies; the app says so.
 */
const text = z.string().trim().min(1).max(1000);
const sendSchema = z.object({ text, requestId: z.string().min(1).max(100) });
const TITLE_CHARS = 60;

const thread = (db: Context["db"], patientId: string) =>
  db.select({ id: careMessages.id, from: careMessages.from, text: careMessages.text, createdAt: careMessages.createdAt })
    .from(careMessages).where(eq(careMessages.patientId, patientId)).orderBy(asc(careMessages.createdAt), asc(careMessages.id));

async function stored(db: Context["db"], id: string) {
  const [row] = await db.select({ id: careMessages.id, from: careMessages.from, text: careMessages.text, createdAt: careMessages.createdAt }).from(careMessages).where(eq(careMessages.id, id));
  return row!;
}

/** Patient side, under care.messages. */
export const careMessagesRouter = {
  list: patientProcedure.handler(({ context }) => thread(context.db, context.patientId)),
  send: patientProcedure.input(sendSchema).handler(async ({ context, input }) => {
    const { db, hospitalId, patientId } = context;
    const id = `message:${patientId}:${input.requestId}`;
    const [patient] = await db.select({ name: patients.name, encounterId: encounters.id }).from(patients)
      .leftJoin(encounters, eq(encounters.patientId, patients.id)).where(eq(patients.id, patientId)).orderBy(desc(encounters.updatedAt)).limit(1);
    const title = `${patient!.name.split(" ")[0]}: ${input.text.length > TITLE_CHARS ? `${input.text.slice(0, TITLE_CHARS).trimEnd()}…` : input.text}`;
    // The task shares the message's ID, so a replay inserts neither.
    await db.insert(tasks).values({ id, hospitalId, encounterId: patient!.encounterId, kind: "message", title, owner: "Attending doctor", due: "Today", sourceId: id, idempotencyKey: id })
      .onConflictDoNothing();
    await db.insert(careMessages).values({ id, hospitalId, patientId, from: "patient", authorId: context.session.user.id, text: input.text, taskId: id, createdAt: clockOf(context) })
      .onConflictDoNothing();
    return stored(db, id);
  }),
};

async function ownPatient(db: Context["db"], hospitalId: string, patientId: string) {
  const [row] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.hospitalId, hospitalId)));
  if (!row) throw new ORPCError("NOT_FOUND", { message: `No patient ${patientId}` });
}

/** Clinician side: a patient's thread, and the care team's reply. */
export const messagesRouter = {
  list: protectedProcedure.input(z.object({ patientId: z.string().min(1) })).handler(async ({ context, input }) => {
    await ownPatient(context.db, context.hospitalId, input.patientId);
    return thread(context.db, input.patientId);
  }),
  reply: protectedProcedure.input(sendSchema.extend({ patientId: z.string().min(1) })).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    await ownPatient(db, hospitalId, input.patientId);
    const id = `message:${input.patientId}:${input.requestId}`;
    await db.insert(careMessages).values({ id, hospitalId, patientId: input.patientId, from: "care-team", authorId: context.session.user.id, text: input.text, createdAt: clockOf(context) })
      .onConflictDoNothing();
    // Answering closes the patient's open message tasks on My Day.
    const asked = await db.select({ taskId: careMessages.taskId }).from(careMessages).where(and(eq(careMessages.patientId, input.patientId), eq(careMessages.from, "patient")));
    const ids = asked.flatMap(m => (m.taskId ? [m.taskId] : []));
    if (ids.length) await db.update(tasks).set({ completed: true }).where(and(inArray(tasks.id, ids), eq(tasks.completed, false)));
    await tellPatient(context, hospitalId, input.patientId, { kind: "reply" });
    return stored(db, id);
  }),
};
