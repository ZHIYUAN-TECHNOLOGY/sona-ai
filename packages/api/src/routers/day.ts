import { ORPCError } from "@orpc/server";
import { appointments, labResults, patients, tasks } from "@sona-ai/db/schema/clinical";
import { and, asc, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { z } from "zod";

import { clockOf, type Context } from "../context";
import { protectedProcedure } from "../index";

/** Marks one of the caller's hospital's tasks done; completing it again returns the same task. */
export const completeTask = protectedProcedure.input(z.object({ taskId: z.string().min(1) })).handler(async ({ context: { db, hospitalId }, input }) => {
  const [task] = await db.update(tasks).set({ completed: true })
    .where(and(eq(tasks.id, input.taskId), eq(tasks.hospitalId, hospitalId))).returning();
  if (!task) throw new ORPCError("NOT_FOUND", { message: `No task ${input.taskId}` });
  return task;
});

/** The hospital's lab results with the patient's name, newest first (lab rows are scoped through their patient). */
const listResults = (db: Context["db"], hospitalId: string, where?: ReturnType<typeof eq>) => db.select({
  id: labResults.id, patientId: labResults.patientId, patientName: patients.name, test: labResults.test, value: labResults.value,
  unit: labResults.unit, flag: labResults.flag, receivedAt: labResults.receivedAt, acknowledgedBy: labResults.acknowledgedBy, acknowledgedAt: labResults.acknowledgedAt,
}).from(labResults).innerJoin(patients, eq(patients.id, labResults.patientId))
  .where(and(eq(patients.hospitalId, hospitalId), where)).orderBy(desc(labResults.receivedAt));

export const resultsRouter = {
  list: protectedProcedure.input(z.object({ unacknowledged: z.boolean().optional() }).optional()).handler(({ context: { db, hospitalId }, input }) =>
    listResults(db, hospitalId, input?.unacknowledged ? isNull(labResults.acknowledgedAt) : undefined)),
  /** Records the first doctor to acknowledge a result; acknowledging it again returns that same record. */
  acknowledge: protectedProcedure.input(z.object({ resultId: z.string().min(1) })).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    const [known] = await listResults(db, hospitalId, eq(labResults.id, input.resultId));
    if (!known) throw new ORPCError("NOT_FOUND", { message: `No lab result ${input.resultId}` });
    await db.update(labResults).set({ acknowledgedBy: context.session.user.id, acknowledgedAt: clockOf(context) })
      .where(and(eq(labResults.id, input.resultId), isNull(labResults.acknowledgedAt)));
    const [result] = await listResults(db, hospitalId, eq(labResults.id, input.resultId));
    return result!;
  }),
};

// ponytail: every demo hospital keeps Malaysian time; read it from the hospital row once one is elsewhere.
const HOSPITAL_UTC_OFFSET = "+08:00";

export const dayRouter = {
  /** The hospital's appointments on a calendar day (in the hospital's time), earliest first, with who is coming. */
  list: protectedProcedure.input(z.object({ date: z.iso.date() })).handler(({ context: { db, hospitalId }, input }) => {
    const start = new Date(`${input.date}T00:00:00${HOSPITAL_UTC_OFFSET}`);
    const end = new Date(start.getTime() + 24 * 3600_000);
    return db.select({
      id: appointments.id, patientId: appointments.patientId, patientName: patients.name, initials: patients.initials,
      incomplete: patients.incomplete, kind: appointments.kind, startsAt: appointments.startsAt,
    }).from(appointments).innerJoin(patients, eq(patients.id, appointments.patientId))
      .where(and(eq(appointments.hospitalId, hospitalId), gte(appointments.startsAt, start), lt(appointments.startsAt, end)))
      .orderBy(asc(appointments.startsAt));
  }),
};
