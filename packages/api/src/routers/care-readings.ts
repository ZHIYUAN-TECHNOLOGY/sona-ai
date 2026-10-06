import { ORPCError } from "@orpc/server";
import { appointments, observations } from "@sona-ai/db/schema/clinical";
import { and, asc, eq, gte } from "drizzle-orm";
import { z } from "zod";

import { clockOf, type Context } from "../context";
import { patientProcedure } from "../index";

/**
 * Sona Care home readings and visit prep. A patient logs a reading at home (announced as "readings"); it is
 * stored on their own chart marked `source: "patient"`, so it is never mistaken for a ward observation.
 * Before their next visit they share up to three questions and, if they choose, their last 7 days of
 * readings (announced as "visitPrep"); the doctor's briefing receives exactly the block `doctorWillSee` shows.
 */
type Db = Context["db"];
const DAY = 86_400_000;

/** Each kind's unit and the range a living person can show; anything outside is a typing slip, refused in plain words. */
export const READING_KINDS = {
  blood_pressure: { label: "Blood pressure", unit: "mmHg", min: 50, max: 260 },
  heart_rate: { label: "Heart rate", unit: "bpm", min: 25, max: 230 },
  temperature: { label: "Temperature", unit: "°C", min: 30, max: 43 },
  weight: { label: "Weight", unit: "kg", min: 2, max: 400 },
  blood_glucose: { label: "Blood glucose", unit: "mmol/L", min: 1, max: 40 },
  oxygen_saturation: { label: "Oxygen saturation", unit: "%", min: 50, max: 100 },
} as const;
type Kind = keyof typeof READING_KINDS;
const KINDS = Object.keys(READING_KINDS) as [Kind, ...Kind[]];
/** The lower number of a blood pressure is its own row, at the same time as the upper one. */
const DIASTOLIC = "blood_pressure_diastolic", DIASTOLIC_RANGE = { min: 30, max: 160 };

const refuse = (message: string) => new ORPCError("BAD_REQUEST", { message, data: { code: "READING_REFUSED" } });

/** The patient's own home readings since `since`, oldest first, a series per kind (blood pressure carries `value2`, the lower number). */
async function readingsOf(db: Db, patientId: string, since: Date) {
  const rows = await db.select().from(observations)
    .where(and(eq(observations.patientId, patientId), eq(observations.source, "patient"), gte(observations.observedAt, since)))
    .orderBy(asc(observations.observedAt));
  const lower = new Map(rows.filter(r => r.kind === DIASTOLIC).map(r => [r.id, r.value]));
  return KINDS.map(kind => ({
    kind, label: READING_KINDS[kind].label, unit: READING_KINDS[kind].unit,
    points: rows.filter(r => r.kind === kind).map(r => ({ id: r.id, at: r.observedAt, value: r.value, ...(kind === "blood_pressure" ? { value2: lower.get(`${r.id}-d`) } : {}) })),
  })).filter(s => s.points.length);
}

/** The patient's next visit at their hospital: the earliest appointment not yet past. */
async function nextVisit(db: Db, hospitalId: string, patientId: string, now: Date) {
  const [next] = await db.select().from(appointments)
    .where(and(eq(appointments.patientId, patientId), eq(appointments.hospitalId, hospitalId), gte(appointments.startsAt, now)))
    .orderBy(asc(appointments.startsAt)).limit(1);
  return next;
}

/**
 * What the patient prepared for their next visit, as the text the briefing reads: their questions, and their
 * last 7 days of home readings only if they chose to share them. Nothing prepared gives nothing.
 */
export async function visitPrepBlock(db: Db, hospitalId: string, patientId: string, now: Date): Promise<string | undefined> {
  const prep = (await nextVisit(db, hospitalId, patientId, now))?.prep;
  if (!prep || (!prep.shareReadings && !prep.questions.length)) return undefined;
  const lines = ["Shared by the patient from Sona Care before this visit:"];
  if (prep.shareReadings) {
    const series = await readingsOf(db, patientId, new Date(now.getTime() - 7 * DAY));
    lines.push(series.length
      ? `Home readings, last 7 days (patient-reported, latest of each): ${series.map(s => {
        const last = s.points.at(-1)!;
        return `${s.label} ${last.value}${"value2" in last && last.value2 != null ? `/${last.value2}` : ""} ${s.unit} (${s.points.length} logged)`;
      }).join("; ")}.`
      : "Home readings, last 7 days: none logged.");
  }
  prep.questions.forEach((q, i) => lines.push(`Patient's question ${i + 1}: ${q}`));
  return lines.join("\n");
}

async function prepOf(context: Context & { hospitalId: string; patientId: string }) {
  const now = clockOf(context);
  const next = await nextVisit(context.db, context.hospitalId, context.patientId, now);
  return {
    appointment: next ? { id: next.id, startsAt: next.startsAt, kind: next.kind } : null,
    questions: next?.prep?.questions ?? [], shareReadings: next?.prep?.shareReadings ?? false,
    doctorWillSee: await visitPrepBlock(context.db, context.hospitalId, context.patientId, now) ?? null,
  };
}

/** Patient side, spread into `care`: care.readings.* and care.visitPrep.*. */
export const careReadingsRouter = {
  readings: {
    /** Logs one home reading on the patient's own chart. `value2` is the lower blood pressure number. */
    add: patientProcedure.input(z.object({ kind: z.enum(KINDS), value: z.number(), value2: z.number().optional(), takenAt: z.coerce.date().optional() }))
      .handler(async ({ context, input }) => {
        const now = clockOf(context), at = input.takenAt ?? now, { label, unit, min, max } = READING_KINDS[input.kind];
        if (input.value < min || input.value > max) throw refuse(`${label} of ${input.value} ${unit} doesn't look right. Please check the number and try again.`);
        const bp = input.kind === "blood_pressure";
        if (bp && (input.value2 == null || input.value2 < DIASTOLIC_RANGE.min || input.value2 > DIASTOLIC_RANGE.max || input.value2 >= input.value))
          throw refuse("Blood pressure needs two numbers, the upper one first, like 120 over 80. Please check and try again.");
        if (at.getTime() > now.getTime() + 5 * 60_000 || at.getTime() < now.getTime() - 90 * DAY) throw refuse("That time doesn't look right. Please choose a time in the last 90 days.");
        const id = crypto.randomUUID(), row = { patientId: context.patientId, unit, sourceId: "sona-care", observedAt: at, source: "patient" as const };
        await context.db.insert(observations).values([
          { ...row, id, kind: input.kind, value: input.value },
          ...(bp ? [{ ...row, id: `${id}-d`, kind: DIASTOLIC, value: input.value2! }] : []),
        ]);
        return { id, kind: input.kind, value: input.value, ...(bp ? { value2: input.value2 } : {}), unit, at };
      }),
    /** The patient's own home readings for a chart: the last `days` days, oldest first, a series per kind. */
    list: patientProcedure.input(z.object({ days: z.number().int().min(1).max(90).default(7) }).default({ days: 7 }))
      .handler(async ({ context, input }) => ({ days: input.days, series: await readingsOf(context.db, context.patientId, new Date(clockOf(context).getTime() - input.days * DAY)) })),
  },
  visitPrep: {
    /** What the patient prepared for their next visit, and exactly what the doctor's briefing will read. */
    get: patientProcedure.handler(({ context }) => prepOf(context)),
    /** Saves the questions (up to three) and whether the last 7 days of readings are shared, on the next visit. */
    save: patientProcedure.input(z.object({ questions: z.array(z.string().trim().min(1).max(200)).max(3), shareReadings: z.boolean() }))
      .handler(async ({ context, input }) => {
        const next = await nextVisit(context.db, context.hospitalId, context.patientId, clockOf(context));
        if (!next) throw new ORPCError("PRECONDITION_FAILED", { message: "You have no visit booked yet, so there is nothing to prepare for.", data: { code: "NO_VISIT" } });
        await context.db.update(appointments).set({ prep: input }).where(eq(appointments.id, next.id));
        return prepOf(context);
      }),
  },
};
