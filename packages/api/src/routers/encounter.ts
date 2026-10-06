import { ORPCError } from "@orpc/server";
import { admissions, appointments, checkInReplies, checkIns, encounters, findings, guaranteeLetters, labResults, notes, observations, patients, provenance, receipts } from "@sona-ai/db/schema/clinical";
import type { MedChange } from "@sona-ai/domain/discharge";
import type { Encounter, Patient } from "@sona-ai/domain/types";
import type { WardRecord } from "@sona-ai/domain/ward";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { encounterEditSchema, recordReviewSchema, type EncounterEdit, type RecordReview } from "../contracts";
import { clockOf, type Context } from "../context";
import { protectedProcedure } from "../index";
import { stubModels, type Origin } from "../models";
import { visitPrepBlock } from "./care-readings";

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
export type PatientRecord = Patient & { ward?: WardRecord; takeHome?: MedChange[] };
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

/** One dated thing the record holds about the visit's patient. */
export type TimelineEvent = { id: string; at: Date; title: string; detail?: string };
const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).replace(/-/g, " ");
const reading = (o: { kind: string; value: number; unit: string }) => o.unit === "AMT" ? `AMT ${o.value}/10` : `${sentenceCase(o.kind)} ${o.value} ${o.unit}`;
/** "Thu, 01 Oct 2026": the day in Malaysia, the same on any server. */
export const malaysiaDay = (at: Date) => new Date(at.getTime() + 8 * 3600_000).toUTCString().slice(0, 16);
/** Results a model reads about one patient: the latest dozen. */
const RESULTS_MAX = 12;

/**
 * A patient's record as the lines a model reads, from what the briefing and its timeline read (recordOf, the chart, the
 * results): age and sex (never the name or the record number), why they came, history, allergy, medicines, the latest
 * reading of each observation and the latest results, each with its day. Nothing is told that no row holds. Only in the
 * caller's hospital: a patient of another hospital has no lines. Sona Care's answers (care-plan's recordText) and the
 * evidence answer's patient section (evidence.ts) read the same lines.
 */
export async function recordFacts(db: Db, hospitalId: string, patientId: string): Promise<string[]> {
  const [row] = await db.select().from(patients).where(and(eq(patients.id, patientId), eq(patients.hospitalId, hospitalId)));
  if (!row) return [];
  const [chart, labs] = await Promise.all([
    db.select().from(observations).where(eq(observations.patientId, patientId)).orderBy(asc(observations.observedAt)),
    db.select().from(labResults).where(eq(labResults.patientId, patientId)).orderBy(desc(labResults.receivedAt)).limit(RESULTS_MAX),
  ]);
  const p = recordOf(row);
  // The last reading of each kind (rows come oldest first); a record with no chart rows keeps the vitals written at intake.
  const latest = [...new Map(chart.map(o => [o.kind, o])).values()];
  return [
    `Age ${p.age}, ${p.sex.toLowerCase()}. Came in with: ${p.complaint}`,
    p.history.length ? `History: ${p.history.join("; ")}` : "",
    p.family ? `Family history: ${p.family}` : "",
    p.social ? `Social history: ${p.social}` : "",
    `Allergies: ${p.allergies ?? "none recorded"}`,
    `Medicines before admission: ${p.medicines.join("; ") || "none recorded"}`,
    latest.length ? `Observations (latest of each): ${latest.map(o => `${reading(o)} (${malaysiaDay(o.observedAt)})`).join(" · ")}`
      : p.vitals?.length ? `Observations at intake: ${p.vitals.map(v => `${v.label} ${v.value}`).join(" · ")}` : "",
    ...(labs.length ? ["Results:", ...labs.map(l => l.flag === "pending" ? `- ${l.test}: sent to the lab, result pending (${malaysiaDay(l.receivedAt)})`
      : `- ${[l.test, l.value, l.unit].filter(Boolean).join(" ")}${l.flag ? `, ${l.flag}` : ""} (${malaysiaDay(l.receivedAt)})`)] : []),
    p.incomplete ? "The record is marked incomplete." : "",
  ].filter(Boolean);
}

/**
 * The briefing's timeline, read from the rows that carry a time: the chart, results, the visit's notes, the stay (fit,
 * guarantee letter, discharge), what a doctor approved, X-ray findings, appointments and check-ins. Oldest first.
 * Nothing is told that no row holds: the schema keeps no time for the admission itself or for when an illness began,
 * so a thin record gives a short timeline, never a story.
 */
export async function timelineOf(db: Db, hospitalId: string, encounterId: string): Promise<TimelineEvent[]> {
  const [visit] = await db.select({ patientId: encounters.patientId }).from(encounters).where(and(eq(encounters.id, encounterId), eq(encounters.hospitalId, hospitalId)));
  if (!visit) throw new ORPCError("NOT_FOUND", { message: `No encounter ${encounterId}` });
  const { patientId } = visit;
  const [chart, labs, saved, stays, approved, found, booked, asked] = await Promise.all([
    db.select().from(observations).where(eq(observations.patientId, patientId)),
    db.select().from(labResults).where(eq(labResults.patientId, patientId)),
    db.select().from(notes).where(eq(notes.encounterId, encounterId)),
    db.select({ admission: admissions, gl: guaranteeLetters }).from(admissions).leftJoin(guaranteeLetters, eq(guaranteeLetters.admissionId, admissions.id)).where(eq(admissions.patientId, patientId)),
    db.select().from(receipts).where(eq(receipts.encounterId, encounterId)),
    db.select().from(findings).where(eq(findings.encounterId, encounterId)),
    db.select().from(appointments).where(and(eq(appointments.patientId, patientId), eq(appointments.hospitalId, hospitalId))),
    db.select({ checkIn: checkIns, reply: checkInReplies }).from(checkIns).leftJoin(checkInReplies, eq(checkInReplies.checkInId, checkIns.id)).where(eq(checkIns.encounterId, encounterId)),
  ]);
  // One round of observations is one event, however many readings it took.
  const rounds = Map.groupBy(chart, o => o.observedAt.getTime());
  const RECEIPT: Record<string, string> = { prescription: "Prescription approved", claim: "Guarantee letter request sent", appeal: "Appeal sent to the insurer" };
  const events: (TimelineEvent | false | null | undefined)[] = [
    ...[...rounds].map(([time, readings]) => ({ id: `observations-${time}`, at: new Date(time), title: readings[0]?.source === "patient" ? "Home readings (patient-reported)" : "Observations", detail: readings.map(reading).join(" · ") })),
    ...labs.map(l => l.flag === "pending" ? { id: l.id, at: l.receivedAt, title: `${l.test} sent to the lab`, detail: "Result pending" }
      : { id: l.id, at: l.receivedAt, title: [l.test, l.value, l.unit].filter(Boolean).join(" "), detail: l.flag ? sentenceCase(l.flag) : undefined }),
    ...saved.map(n => ({ id: n.id, at: n.createdAt, title: n.revision === 1 ? "Note saved" : "Note updated", detail: n.sentences[0]?.text })),
    ...stays.flatMap(({ admission: a, gl }) => [
      a.fitAt && { id: `${a.id}-fit`, at: a.fitAt, title: "Marked fit for discharge", detail: a.bed },
      gl && { id: `${gl.id}-requested`, at: gl.requestedAt, title: "Final guarantee letter requested", detail: gl.insurer },
      gl?.receivedAt && { id: `${gl.id}-received`, at: gl.receivedAt, title: "Final guarantee letter received", detail: gl.insurer },
      a.dischargedAt && { id: `${a.id}-discharged`, at: a.dischargedAt, title: "Discharged", detail: `${a.bed} freed` },
    ]),
    // The discharge's receipt is the same moment as the admission's discharge time, so it is not told twice.
    ...approved.map(r => RECEIPT[r.kind] !== undefined && { id: r.id, at: r.createdAt, title: RECEIPT[r.kind]!, detail: r.kind === "prescription" ? [(r.payload as { medication?: string }).medication, (r.payload as { simulated?: boolean }).simulated && "simulated, not dispensed"].filter(Boolean).join(" · ") : undefined }),
    ...found.map(f => ({ id: f.id, at: f.createdAt, title: "X-ray finding", detail: `${f.label} · not validated` })),
    ...booked.map(a => ({ id: a.id, at: a.startsAt, title: sentenceCase(a.kind) })),
    ...asked.flatMap(({ checkIn: c, reply }) => [
      c.sentAt && { id: c.id, at: c.sentAt, title: `Day ${c.day} check-in sent` },
      reply && { id: reply.id, at: reply.receivedAt, title: `Check-in reply: ${reply.label}`, detail: reply.text },
    ]),
  ];
  return events.filter((e): e is TimelineEvent => Boolean(e)).sort((a, b) => a.at.getTime() - b.at.getTime());
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
    const answer = await (context.models ?? stubModels).briefing({ patient, visitPrep: await visitPrepBlock(context.db, context.hospitalId, patient.id, clockOf(context)) });
    return logAnswer(context.db, input.encounterId, "briefing", answer, recordSources(patient));
  }),
  /** The briefing's timeline: the dated events the record holds for this visit's patient (timelineOf). */
  timeline: protectedProcedure.input(z.object({ encounterId: z.string().min(1) })).handler(({ context, input }) => timelineOf(context.db, context.hospitalId, input.encounterId)),
  reasoning: protectedProcedure.input(z.object({ encounterId: z.string().min(1), question: z.string().trim().min(1).max(500) })).handler(async ({ context, input }) => {
    const { patient } = await visitOf(context.db, context.hospitalId, input.encounterId);
    const answer = await (context.models ?? stubModels).reasoning({ patient, question: input.question });
    return logAnswer(context.db, input.encounterId, "reasoning", answer, answer.sourceIds);
  }),
};
