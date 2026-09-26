import { ORPCError } from "@orpc/server";
import { user } from "@sona-ai/db/schema/auth";
import { appointments, encounters, labResults, patients, tasks } from "@sona-ai/db/schema/clinical";
import type { DemoPatient } from "@sona-ai/domain/demo-patients";
import { criticalOf } from "@sona-ai/domain/critical";
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

/** The hospital's lab results with the patient's name and who acknowledged each, newest first (lab rows are scoped through their patient). */
const listResults = async (db: Context["db"], hospitalId: string, where?: ReturnType<typeof eq>) => (await db.select({
  id: labResults.id, patientId: labResults.patientId, patientName: patients.name, test: labResults.test, value: labResults.value,
  unit: labResults.unit, flag: labResults.flag, receivedAt: labResults.receivedAt, acknowledgedBy: labResults.acknowledgedBy, acknowledgedAt: labResults.acknowledgedAt,
  acknowledgedByName: user.name,
}).from(labResults).innerJoin(patients, eq(patients.id, labResults.patientId)).leftJoin(user, eq(user.id, labResults.acknowledgedBy))
  .where(and(eq(patients.hospitalId, hospitalId), where)).orderBy(desc(labResults.receivedAt)))
  .map(r => ({ ...r, critical: Boolean(r.flag?.startsWith("critical")) }));

export const resultsRouter = {
  list: protectedProcedure.input(z.object({ unacknowledged: z.boolean().optional() }).optional()).handler(({ context: { db, hospitalId }, input }) =>
    listResults(db, hospitalId, input?.unacknowledged ? isNull(labResults.acknowledgedAt) : undefined)),
  /**
   * The lab feed, simulated for the demo: a result arrives for one of the hospital's patients, flagged
   * critical by rule when it is past a call-now limit. ponytail: a real lab posts HL7/FHIR here.
   */
  receive: protectedProcedure.input(z.object({ patientId: z.string().min(1), test: z.string().trim().min(1), value: z.string().trim().min(1), unit: z.string().trim().min(1).optional() }))
    .handler(async ({ context, input }) => {
      const { db, hospitalId } = context;
      const [patient] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, input.patientId), eq(patients.hospitalId, hospitalId)));
      if (!patient) throw new ORPCError("NOT_FOUND", { message: `No patient ${input.patientId}` });
      const id = `lab-${crypto.randomUUID()}`;
      await db.insert(labResults).values({ id, patientId: input.patientId, test: input.test, value: input.value, unit: input.unit, flag: criticalOf(input) ?? null, sourceId: id, receivedAt: clockOf(context) });
      const [result] = await listResults(db, hospitalId, eq(labResults.id, id));
      return result!;
    }),
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

export const patientsRouter = {
  /** The hospital's patients with their full record and visit, in ID order; the visit time comes from appointments. */
  list: protectedProcedure.handler(async ({ context: { db, hospitalId } }) => {
    const rows = await db.select({ patient: patients, encounterId: encounters.id }).from(patients)
      .leftJoin(encounters, eq(encounters.patientId, patients.id)).where(eq(patients.hospitalId, hospitalId)).orderBy(asc(patients.id));
    return rows.map(({ patient: p, encounterId }): DemoPatient => ({
      ...(p.record as Omit<DemoPatient, "id" | "encounterId" | "name" | "initials" | "age" | "sex" | "complaint" | "allergies" | "incomplete">),
      id: p.id, encounterId: encounterId ?? "", name: p.name, initials: p.initials, age: p.age, sex: p.sex, complaint: p.complaint, allergies: p.allergies, incomplete: p.incomplete,
    }));
  }),
};
