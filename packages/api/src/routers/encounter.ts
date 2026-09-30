import { ORPCError } from "@orpc/server";
import { encounters, patients, provenance } from "@sona-ai/db/schema/clinical";
import type { Encounter, Patient } from "@sona-ai/domain/types";
import type { WardRecord } from "@sona-ai/domain/ward";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { encounterEditSchema, recordReviewSchema, type EncounterEdit, type RecordReview } from "../contracts";
import type { Context } from "../context";
import { protectedProcedure } from "../index";
import { stubModels, type Origin } from "../models";

/**
 * Encounter state on the server. Postgres holds the snapshot and is the arbiter of revisions: every
 * write is conditional on the revision the caller last saw, so the Worker and the encounter's
 * Durable Object can never both win. An eligibility, medicine or history edit bumps the revision and
 * invalidates the medication review, as reviseEncounter does in the app.
 */
export type EncounterState = Omit<Partial<Encounter>, "revision">;
export type EncounterSnapshot = { encounterId: string; revision: number; state: EncounterState };
type Db = Context["db"];



/** A patient row with its record spread back over it: what the models and planFor read. */
export type PatientRecord = Patient & { ward?: WardRecord };
export const recordOf = (row: typeof patients.$inferSelect, encounterId = ""): PatientRecord => ({
  ...(row.record as Omit<PatientRecord, "id">), id: row.id, encounterId, time: "", name: row.name, initials: row.initials, age: row.age, sex: row.sex,
  complaint: row.complaint, allergies: row.allergies, incomplete: row.incomplete,
  history: (row.record as { history?: string[] }).history ?? [], medicines: (row.record as { medicines?: string[] }).medicines ?? [],
});

/** The patient's own record and transcript sources (not the reference library or teaching images): what a drafted answer cites. */
export const recordSources = (patient: PatientRecord) => (patient.sources ?? []).filter(s => s.kind === "record" || s.kind === "transcript").map(s => s.id);

/** The visit and its patient's whole record, only in the caller's hospital (another hospital's visit is not found). */
export async function visitOf(db: Db, hospitalId: string, encounterId: string) {
  const [row] = await db.select({ patient: patients, state: encounters.state }).from(encounters).innerJoin(patients, eq(patients.id, encounters.patientId))
    .where(and(eq(encounters.id, encounterId), eq(encounters.hospitalId, hospitalId)));
  if (!row) throw new ORPCError("NOT_FOUND", { message: `No encounter ${encounterId}` });
  return { patient: recordOf(row.patient, encounterId), state: row.state as EncounterState };
}

/**
 * Logs a model answer (or the fixture standing in for one) with the sources it drew on, as every AI
 * output is (delivery plan, provenance), and returns where it came from so the app can label it.
 */
export async function logAnswer<T extends Origin>(db: Db, encounterId: string | null, kind: string, answer: T, sourceIds: string[]) {
  const { source: _, model: __, waking: ___, ...output } = answer as T & { model?: string; waking?: number };
  await db.insert(provenance).values({ id: crypto.randomUUID(), encounterId, kind, output, sourceIds, model: answer.source === "model" ? answer.model : "fixture", approvedBy: null });
  return answer;
}

export const stale = (encounterId: string) => new ORPCError("CONFLICT", { message: `Encounter ${encounterId} has moved on; reload and retry` });

export async function loadEncounter(db: Db, hospitalId: string, encounterId: string): Promise<EncounterSnapshot> {
  const [row] = await db.select({ revision: encounters.revision, state: encounters.state }).from(encounters)
    .where(and(eq(encounters.id, encounterId), eq(encounters.hospitalId, hospitalId)));
  if (!row) throw new ORPCError("NOT_FOUND", { message: `No encounter ${encounterId}` });
  return { encounterId, revision: row.revision, state: row.state as EncounterState };
}

export function applyEdit(current: EncounterSnapshot, edit: EncounterEdit): EncounterSnapshot {
  if (edit.expectedRevision !== current.revision) throw stale(current.encounterId);
  const { encounterId: _, expectedRevision: __, ...fields } = edit;
  const { medicationCheckedRevision, reviewInvalidated, ...rest } = current.state;
  return {
    encounterId: current.encounterId, revision: current.revision + 1,
    state: { ...rest, ...fields, reviewInvalidated: medicationCheckedRevision !== undefined || Boolean(reviewInvalidated) },
  };
}

/** Marks the medication review current at this revision; a review of an older revision is refused. */
export function applyReview(current: EncounterSnapshot, review: RecordReview): EncounterSnapshot {
  if (review.expectedRevision !== current.revision) throw stale(current.encounterId);
  return { ...current, state: { ...current.state, medicationCheckedRevision: current.revision, reviewInvalidated: false } };
}

/** Writes the snapshot only if Postgres is still at `fromRevision`; otherwise someone else wrote first. */
export async function saveEncounter(db: Db, hospitalId: string, fromRevision: number, next: EncounterSnapshot) {
  const rows = await db.update(encounters).set({ revision: next.revision, state: next.state, updatedAt: new Date() })
    .where(and(eq(encounters.id, next.encounterId), eq(encounters.hospitalId, hospitalId), eq(encounters.revision, fromRevision)))
    .returning({ id: encounters.id });
  if (!rows.length) throw stale(next.encounterId);
  return next;
}

/** Through the encounter's Durable Object when the Worker provides it, so its live state never goes stale. */
export async function editEncounter(context: Pick<Context, "db" | "encounters">, hospitalId: string, edit: EncounterEdit) {
  if (context.encounters) return context.encounters.edit(hospitalId, edit);
  const current = await loadEncounter(context.db, hospitalId, edit.encounterId);
  return saveEncounter(context.db, hospitalId, current.revision, applyEdit(current, edit));
}

export const encounterRouter = {
  get: protectedProcedure.input(z.object({ encounterId: z.string().min(1) }))
    .handler(({ context, input }) => loadEncounter(context.db, context.hospitalId, input.encounterId)),
  edit: protectedProcedure.input(encounterEditSchema).handler(({ context, input }) => editEncounter(context, context.hospitalId, input)),
  recordReview: protectedProcedure.input(recordReviewSchema).handler(async ({ context, input }) => {
    const { hospitalId } = context;
    if (context.encounters) return context.encounters.recordReview(hospitalId, input);
    const current = await loadEncounter(context.db, hospitalId, input.encounterId);
    return saveEncounter(context.db, hospitalId, current.revision, applyReview(current, input));
  }),
  /** What to know before seeing the patient, read from their own record (a labelled fixture until Gemma is on). */
  briefing: protectedProcedure.input(z.object({ encounterId: z.string().min(1) })).handler(async ({ context, input }) => {
    const { patient } = await visitOf(context.db, context.hospitalId, input.encounterId);
    const answer = await (context.models ?? stubModels).briefing({ patient });
    return logAnswer(context.db, input.encounterId, "briefing", answer, recordSources(patient));
  }),
  reasoning: protectedProcedure.input(z.object({ encounterId: z.string().min(1), question: z.string().trim().min(1).max(500) })).handler(async ({ context, input }) => {
    const { patient } = await visitOf(context.db, context.hospitalId, input.encounterId);
    const answer = await (context.models ?? stubModels).reasoning({ patient, question: input.question });
    return logAnswer(context.db, input.encounterId, "reasoning", answer, answer.sourceIds);
  }),
};
