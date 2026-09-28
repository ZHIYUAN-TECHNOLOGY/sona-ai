import { ORPCError } from "@orpc/server";
import { doseLogs, patients } from "@sona-ai/db/schema/clinical";
import { adherence, doseSlots, missedLine, parseDoseKey } from "@sona-ai/domain/doses";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { clockOf, type Context } from "../context";
import { patientProcedure, protectedProcedure } from "../index";
import { doseScheduleOf } from "./care-plan";

/**
 * Doses taken, from Sona Care's hold to take, so the care team sees adherence: the patient marks a
 * dose (announced as "doses", so My Day re-reads), and a clinician reads the patient's adherence
 * (taken of due since discharge, what is missed and what is late) with a one-line summary.
 */
const takenKeys = async (db: Context["db"], hospitalId: string, patientId: string) =>
  (await db.select({ key: doseLogs.key }).from(doseLogs).where(and(eq(doseLogs.hospitalId, hospitalId), eq(doseLogs.patientId, patientId)))).map(r => r.key);

async function adherenceOf(context: Context, hospitalId: string, patientId: string) {
  const schedule = await doseScheduleOf(context.db, hospitalId, patientId);
  const a = adherence(schedule?.meds ?? [], schedule?.dischargedAt, await takenKeys(context.db, hospitalId, patientId), clockOf(context));
  return { ...a, line: missedLine(a) };
}

/** Patient side, under care.doses. */
export const careDosesRouter = {
  /** The dose keys this patient marked taken, so every phone they use agrees. */
  list: patientProcedure.handler(({ context }) => takenKeys(context.db, context.hospitalId, context.patientId)),
  /** Marks one dose of her own plan taken; marking it again changes nothing. A key that is not one of her doses is refused. */
  take: patientProcedure.input(z.object({ key: z.string().min(3).max(200) })).handler(async ({ context, input }) => {
    const dose = parseDoseKey(input.key);
    const schedule = await doseScheduleOf(context.db, context.hospitalId, context.patientId);
    const med = dose && schedule?.meds.find(m => m.name === dose.name);
    const real = med && doseSlots(med, new Date(schedule!.dischargedAt), new Date(dose!.dueAt.getTime() + 1)).some(d => d.getTime() === dose!.dueAt.getTime());
    if (!real) throw new ORPCError("BAD_REQUEST", { message: "That isn't one of your doses", data: { code: "DOSE_UNKNOWN" } });
    await context.db.insert(doseLogs).values({ id: `${context.patientId}|${input.key}`, hospitalId: context.hospitalId, patientId: context.patientId, key: input.key, takenAt: clockOf(context) })
      .onConflictDoNothing();
    return { key: input.key };
  }),
};

/** Clinician side: one patient's adherence (their own hospital only). */
export const adherenceRouter = {
  get: protectedProcedure.input(z.object({ patientId: z.string().min(1) })).handler(async ({ context, input }) => {
    const [p] = await context.db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, input.patientId), eq(patients.hospitalId, context.hospitalId)));
    if (!p) throw new ORPCError("NOT_FOUND", { message: `No patient ${input.patientId}` });
    return adherenceOf(context, context.hospitalId, p.id);
  }),
};
