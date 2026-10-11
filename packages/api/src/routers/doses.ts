import { ORPCError } from "@orpc/server";
import { careLinks, doseLogs, patients, tasks } from "@sona-ai/db/schema/clinical";
import { adherence, doseKey, doseSlots, missedLine, parseDoseKey } from "@sona-ai/domain/doses";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { clockOf, type Context } from "../context";
import { patientProcedure, protectedProcedure } from "../index";
import { doseScheduleOf, lastDischarge, takenKeys } from "./care-plan";

/**
 * Doses taken, from Sona Care's hold to take, so the care team sees adherence: the patient marks a
 * dose (announced as "doses", so My Day re-reads), and a clinician reads the patient's adherence
 * (taken of due since discharge, what is missed and what is late) with a one-line summary.
 */
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
    // Taking a dose again is back on track: her missed-doses row leaves My Day (the "doses" announce re-reads it).
    const visit = await lastDischarge(context.db, context.hospitalId, context.patientId);
    if (visit) await context.db.update(tasks).set({ completed: true })
      .where(and(eq(tasks.hospitalId, context.hospitalId), eq(tasks.encounterId, visit.encounterId), eq(tasks.kind, "dose"), eq(tasks.completed, false)));
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

/**
 * The hourly cron's dose check: a linked patient with doses missed (not taken MISSED_AFTER past due) gets one
 * "dose" task for the attending doctor ("Amelia: 2 Azithromycin doses missed"), an amber row on My Day. It rides on
 * her open one (the title follows the count) and is raised once per newest missed dose (its sourceId), so a row the
 * doctor or her next dose cleared stays cleared until another dose is missed. Returns whose row is new or changed.
 */
export async function raiseMissedDoses(db: Context["db"], hospitalId: string, now: Date) {
  const linked = await db.selectDistinct({ patientId: careLinks.patientId, name: patients.name }).from(careLinks)
    .innerJoin(patients, eq(patients.id, careLinks.patientId)).where(eq(careLinks.hospitalId, hospitalId));
  const told: string[] = [];
  for (const { patientId, name } of linked) {
    const [visit, schedule] = await Promise.all([lastDischarge(db, hospitalId, patientId), doseScheduleOf(db, hospitalId, patientId)]);
    if (!visit || !schedule) continue;
    const a = adherence(schedule.meds, schedule.dischargedAt, await takenKeys(db, hospitalId, patientId), now);
    const line = missedLine(a);
    if (!line) continue;
    const newest = a.missed.reduce((x, y) => (y.dueAt > x.dueAt ? y : x));
    const sourceId = doseKey(newest.name, newest.dueAt), title = `${name.split(" ")[0]}: ${line}`;
    const mine = await db.select({ id: tasks.id, completed: tasks.completed, sourceId: tasks.sourceId }).from(tasks)
      .where(and(eq(tasks.hospitalId, hospitalId), eq(tasks.encounterId, visit.encounterId), eq(tasks.kind, "dose")));
    if (mine.some(t => t.sourceId === sourceId)) continue;
    const open = mine.find(t => !t.completed);
    if (open) await db.update(tasks).set({ title, sourceId }).where(eq(tasks.id, open.id));
    else {
      const id = `dose:${patientId}:${sourceId}`;
      await db.insert(tasks).values({ id, hospitalId, encounterId: visit.encounterId, kind: "dose", title, owner: "Attending doctor", due: "Today", sourceId, idempotencyKey: id })
        .onConflictDoNothing();
    }
    told.push(patientId);
  }
  return told;
}
