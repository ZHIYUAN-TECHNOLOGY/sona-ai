import { ORPCError } from "@orpc/server";
import { user } from "@sona-ai/db/schema/auth";
import { appointments, encounters, labResults, observations, patients, tasks } from "@sona-ai/db/schema/clinical";
import type { DemoPatient } from "@sona-ai/domain/demo-patients";
import { criticalOf, criticalWhy } from "@sona-ai/domain/critical";
import { and, asc, desc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { taskCreateSchema } from "../contracts";
import { clockOffsetOf, shifted } from "../clock";
import { clockOf, type Context } from "../context";
import { changeFor } from "../events";
import { protectedProcedure } from "../index";

/** Marks one of the caller's hospital's tasks done; completing it again returns the same task. */
export const completeTask = protectedProcedure.input(z.object({ taskId: z.string().min(1) })).handler(async ({ context: { db, hospitalId }, input }) => {
  const [task] = await db.update(tasks).set({ completed: true })
    .where(and(eq(tasks.id, input.taskId), eq(tasks.hospitalId, hospitalId))).returning();
  if (!task) throw new ORPCError("NOT_FOUND", { message: `No task ${input.taskId}` });
  return task;
});

// lane T2
/** Saves a doctor's follow-up for one of the hospital's visits; replaying the requestId returns the same task. */
export const createTask = protectedProcedure.input(taskCreateSchema).handler(async ({ context: { db, hospitalId }, input }) => {
  const [visit] = await db.select({ id: encounters.id }).from(encounters).where(and(eq(encounters.id, input.encounterId), eq(encounters.hospitalId, hospitalId)));
  if (!visit) throw new ORPCError("NOT_FOUND", { message: `No encounter ${input.encounterId}` });
  const idempotencyKey = `followup:${input.requestId}`;
  await db.insert(tasks).values({
    id: crypto.randomUUID(), hospitalId, encounterId: visit.id, kind: "followup", title: input.title, owner: input.owner, due: input.due, idempotencyKey,
  }).onConflictDoNothing();
  // Scoped to the hospital too: the key is unique across hospitals, and another's task is never returned.
  const [task] = await db.select().from(tasks).where(and(eq(tasks.idempotencyKey, idempotencyKey), eq(tasks.hospitalId, hospitalId)));
  if (!task) throw new ORPCError("CONFLICT", { message: "That request ID is already used" });
  return task;
});

/** The hospital's lab results with the patient's name and who acknowledged each, newest first (lab rows are scoped through their patient). */
export const listResults = async (db: Context["db"], hospitalId: string, where?: ReturnType<typeof eq>) => (await db.select({
  id: labResults.id, patientId: labResults.patientId, patientName: patients.name, test: labResults.test, value: labResults.value,
  unit: labResults.unit, flag: labResults.flag, receivedAt: labResults.receivedAt, acknowledgedBy: labResults.acknowledgedBy, acknowledgedAt: labResults.acknowledgedAt,
  acknowledgedByName: user.name,
}).from(labResults).innerJoin(patients, eq(patients.id, labResults.patientId)).leftJoin(user, eq(user.id, labResults.acknowledgedBy))
  .where(and(eq(patients.hospitalId, hospitalId), where)).orderBy(desc(labResults.receivedAt)))
  // `why` is the call-now rule's own reason, only when that rule is what set the stored flag (no reference ranges are held anywhere, so none are returned).
  .map(r => ({ ...r, critical: Boolean(r.flag?.startsWith("critical")), why: r.flag && r.flag === criticalOf(r) ? criticalWhy(r) : undefined }));

// A result with no unit (a culture's text) is one: a sender that fills every field sends `unit: ""`, which means none, not a bad request.
const resultInput = z.object({ patientId: z.string().min(1), test: z.string().trim().min(1), value: z.string().trim().min(1), unit: z.string().trim().optional().transform(unit => unit || undefined) });

/**
 * A result arrives for one of the hospital's patients, flagged critical by rule when it is past a call-now limit.
 * The one path for a result, whoever sends it: the lab's system (labFeed) or a signed-in clinician (results.receive).
 */
async function receiveResult(context: Pick<Context, "db" | "now">, hospitalId: string, input: z.infer<typeof resultInput>) {
  const { db } = context;
  const [patient] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, input.patientId), eq(patients.hospitalId, hospitalId)));
  if (!patient) throw new ORPCError("NOT_FOUND", { message: `No patient ${input.patientId}` });
  // A sample the lab was still running (a ward and discharge blocker) is filled in place, keeping its ID; anything else is a new result.
  const [pending] = await db.select({ id: labResults.id }).from(labResults)
    .where(and(eq(labResults.patientId, input.patientId), eq(labResults.flag, "pending"), sql`lower(${labResults.test}) = lower(${input.test})`)).orderBy(asc(labResults.receivedAt)).limit(1);
  const id = pending?.id ?? `lab-${crypto.randomUUID()}`;
  const values = { value: input.value, unit: input.unit, flag: criticalOf(input) ?? null, receivedAt: clockOf(context) };
  if (pending) await db.update(labResults).set(values).where(eq(labResults.id, id));
  else await db.insert(labResults).values({ id, patientId: input.patientId, test: input.test, sourceId: id, ...values });
  const [result] = await listResults(db, hospitalId, eq(labResults.id, id));
  return result!;
}

const sha256 = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))).join();

/**
 * The lab system's way in (POST /lab/results on the Worker): no person is signed in, so the credential is the shared
 * secret in LAB_FEED_SECRET, sent as `Authorization: Bearer <secret>`. With no secret set the route does not exist
 * (404), so nothing is open by accident. The body is results.receive's input; the result goes down the same path
 * (receiveResult), on the patient's hospital's clock, and is announced to that hospital's connected apps as a signed-in
 * write is, so Sona Pro's critical banner appears as it lands.
 * ponytail: one secret for the whole deployment, and the patient ID picks the hospital; a credential per hospital's lab,
 * and HL7/FHIR messages in place of this JSON, once a second lab connects. Not in the access trail, which names users.
 */
export async function labFeed(context: Pick<Context, "db" | "now" | "announce">, secret: string | undefined, request: Request): Promise<Response> {
  if (!secret) return Response.json({ error: "The lab feed is not switched on" }, { status: 404 });
  const given = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  // Compared as digests, so how long the comparison takes says nothing about the secret.
  if (!given || await sha256(given) !== await sha256(secret)) return Response.json({ error: "Wrong or missing lab credential" }, { status: 401 });
  const input = resultInput.safeParse(await request.json().catch(() => undefined));
  if (!input.success) return Response.json({ error: "Expected { patientId, test, value, unit? }" }, { status: 400 });
  const { db } = context;
  const [patient] = await db.select({ hospitalId: patients.hospitalId }).from(patients).where(eq(patients.id, input.data.patientId));
  if (!patient) return Response.json({ error: `No patient ${input.data.patientId}` }, { status: 404 });
  const result = await receiveResult({ db, now: shifted(context.now, await clockOffsetOf(db, patient.hospitalId)) }, patient.hospitalId, input.data);
  // The same change a signed-in results.receive announces; a failed announcement never fails the write.
  await context.announce?.(patient.hospitalId, changeFor(["results", "receive"], input.data)!).catch(() => {});
  return Response.json(result, { status: 201 });
}

export const resultsRouter = {
  // A sample still at the lab ("pending") is a ward blocker, not a result to act on.
  list: protectedProcedure.input(z.object({ unacknowledged: z.boolean().optional(), patientId: z.string().min(1).optional() }).optional()).handler(async ({ context: { db, hospitalId }, input }) =>
    (await listResults(db, hospitalId, and(input?.unacknowledged ? isNull(labResults.acknowledgedAt) : undefined, input?.patientId ? eq(labResults.patientId, input.patientId) : undefined)))
      .filter(r => r.flag !== "pending")),
  /** A result entered from inside the app by a signed-in clinician (Settings' simulate button); the lab's own system posts through labFeed. */
  receive: protectedProcedure.input(resultInput).handler(({ context, input }) => receiveResult(context, context.hospitalId, input)),
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
  /** One patient's observation and lab series over the 12 months up to now (the demo clock), per kind and per test, oldest first; labs keep numeric values only. */
  trends: protectedProcedure.input(z.object({ patientId: z.string().min(1) })).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    const [patient] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, input.patientId), eq(patients.hospitalId, hospitalId)));
    if (!patient) throw new ORPCError("NOT_FOUND", { message: `No patient ${input.patientId}` });
    const now = clockOf(context);
    const since = new Date(now);
    since.setFullYear(since.getFullYear() - 1);
    const [obs, labs] = await Promise.all([
      db.select().from(observations).where(and(eq(observations.patientId, patient.id), gte(observations.observedAt, since), lte(observations.observedAt, now))).orderBy(asc(observations.observedAt)),
      db.select().from(labResults).where(and(eq(labResults.patientId, patient.id), gte(labResults.receivedAt, since), lte(labResults.receivedAt, now))).orderBy(asc(labResults.receivedAt)),
    ]);
    return {
      // A home reading is never drawn on the same line as a ward observation: one series per kind and source.
      observations: series(obs, o => `${o.source}:${o.kind}`, o => o.unit, o => ({ at: o.observedAt, value: o.value }))
        .map(({ name, ...s }) => ({ kind: name.slice(name.indexOf(":") + 1), source: name.startsWith("patient:") ? "patient" as const : "clinical" as const, ...s })),
      labs: series(labs.filter(l => l.value.trim() !== "" && Number.isFinite(Number(l.value))), l => l.test, l => l.unit, l => ({ at: l.receivedAt, value: Number(l.value), flag: l.flag })).map(({ name: test, ...s }) => ({ test, ...s })),
    };
  }),
};

/** Rows grouped into one series per name, in the order each name first appears; the unit is the first row's. */
function series<R, P>(rows: R[], name: (r: R) => string, unit: (r: R) => string | null, point: (r: R) => P) {
  const byName = new Map<string, { unit: string | null; points: P[] }>();
  for (const r of rows) {
    const s = byName.get(name(r)) ?? { unit: unit(r), points: [] };
    byName.set(name(r), s);
    s.points.push(point(r));
  }
  return [...byName].map(([n, s]) => ({ name: n, ...s }));
}
