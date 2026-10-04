import { ORPCError } from "@orpc/server";
import { admissions, encounters, findings, guaranteeLetters, labResults, observations, patients, provenance, receipts, tasks } from "@sona-ai/db/schema/clinical";
import { EMPTY_DISCHARGE, TYPICAL_WAIT_MINUTES, checkInDaysOf, decideDischarge, dischargeChecks, dischargeTasks, planFor, type DischargeState, type Language, type VisitFacts, type Wait } from "@sona-ai/domain/discharge";
import { and, asc, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { answerOnce } from "../answers";
import { clockOf, type Context } from "../context";
import { dischargeRequestSchema, dischargeUpdateSchema } from "../contracts";
import { protectedProcedure } from "../index";
import { stubModels } from "../models";
import { listFindings } from "./findings";
import { assertApprover } from "./hospital";
import { loadEncounter, recordOf, recordSources, visitOf, type EncounterSnapshot } from "./encounter";
import { scheduleCheckIns } from "./check-ins";
import { staffName } from "./messages";

/**
 * The patient leaflet as approved at discharge, in the discharge language; kept in the visit's discharge state. It is a
 * model's draft a doctor approved, and says so: the model that drafted it, and who approved it and when (their name as
 * the patient reads it). A discharge from before these were kept has the words only.
 */
export type ApprovedLeaflet = { language: Language; text: string; model?: string; approvedBy?: string; approvedAt?: string };

/** A model's stored discharge drafts for the visit (never the stub's rule-built stand-in). */
const modelDraft = (encounterId: string) => and(eq(provenance.encounterId, encounterId), eq(provenance.kind, "discharge-draft"), ne(provenance.model, "fixture"));

/**
 * The visit's plan as its own rows give it: the patient's record, the bed and fit time from their admission, the
 * guarantee letter that stay waits on, the chart's latest reading of each observation, and whether a model's draft is
 * stored. `waits` is the rest of what the ward shows as blocking the bed (ward.ts, bedBlockers): pending results and
 * a ride still to arrange. What the app shows (discharge.plan) and what the server checks (discharge.request) are this one read.
 */
async function visitPlan(db: Context["db"], encounter: EncounterSnapshot) {
  const { encounterId } = encounter;
  const [row] = await db.select({ patient: patients, admission: admissions }).from(encounters)
    .innerJoin(patients, eq(patients.id, encounters.patientId))
    .leftJoin(admissions, eq(admissions.patientId, patients.id))
    .where(eq(encounters.id, encounterId)).orderBy(desc(admissions.id)).limit(1);
  const { patient, admission } = row!;
  const [letters, chart, drafts, pending] = await Promise.all([
    admission ? db.select().from(guaranteeLetters).where(eq(guaranteeLetters.admissionId, admission.id)) : [],
    db.select().from(observations).where(eq(observations.patientId, patient.id)).orderBy(asc(observations.observedAt)),
    db.select({ id: provenance.id }).from(provenance).where(modelDraft(encounterId)).limit(1),
    db.select({ id: labResults.id, test: labResults.test }).from(labResults).where(and(eq(labResults.patientId, patient.id), eq(labResults.flag, "pending"))),
  ]);
  const gl = letters[0];
  // Oldest first, so the last reading of each kind is the one kept.
  const latest = [...new Map(chart.map(o => [o.kind, o])).values()];
  const visit: VisitFacts = {
    fitAt: admission?.fitAt?.toISOString(), gl: gl && { insurer: gl.insurer, requestedAt: gl.requestedAt.toISOString() },
    vitals: latest.map(o => ({ kind: o.kind, value: o.value, unit: o.unit, at: o.observedAt.toISOString() })), drafted: drafts.length > 0,
  };
  const person = recordOf(patient, encounterId);
  const transport = (encounter.state as { transport?: { label: string; detail: string } }).transport;
  const waits: Wait[] = [
    ...pending.map(r => ({ id: `result-${r.id}`, label: r.test, detail: "Pending" })),
    ...(transport ? [{ id: "transport", ...transport }] : []),
  ];
  return { patient, admission, gl, person, plan: planFor({ ...person, bed: admission?.bed, visit }), waits };
}

/**
 * Discharge is refused while any blocker is open, whatever the app shows. Every side effect is
 * idempotent and the receipt is written last, so a replay (same requestId) or a second approval
 * for the same encounter returns the one receipt. No transaction: Neon's HTTP driver has none.
 */
export const dischargeRouter = {
  /**
   * The summary and the leaflet in the chosen language, drafted from the patient's own record (a labelled fixture until
   * Gemma is on). The model drafts once per record and language: opening the card again shows the same draft.
   */
  draft: protectedProcedure.input(z.object({ encounterId: z.string().min(1), language: z.enum(["ms", "en", "zh"]) })).handler(async ({ context, input }) => {
    const { patient } = await visitOf(context.db, context.hospitalId, input.encounterId);
    const asked = { patient, language: input.language };
    return answerOnce(context.db, input.encounterId, "discharge-draft", asked,
      async () => ({ ...await (context.models ?? stubModels).draftDischarge(asked), language: input.language }), () => recordSources(patient));
  }),
  /** The discharge card's plan and what else holds the bed, read from the visit's rows (visitPlan): the same facts discharge.request checks. */
  plan: protectedProcedure.input(z.object({ encounterId: z.string().min(1) })).handler(async ({ context: { db, hospitalId }, input }) => {
    const { plan, waits } = await visitPlan(db, await loadEncounter(db, hospitalId, input.encounterId));
    return { plan, waits };
  }),
  /** Inline fixes on the discharge card. They do not touch prescribing, so the revision stays put. */
  update: protectedProcedure.input(dischargeUpdateSchema).handler(async ({ context: { db, hospitalId }, input }) => {
    const { encounterId, ...patch } = input;
    await loadEncounter(db, hospitalId, encounterId);
    await db.update(encounters)
      .set({ state: sql`jsonb_set(${encounters.state}, '{discharge}', coalesce(${encounters.state}->'discharge', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)`, updatedAt: new Date() })
      .where(eq(encounters.id, encounterId));
    return loadEncounter(db, hospitalId, encounterId);
  }),
  request: protectedProcedure.input(dischargeRequestSchema).handler(async ({ context, input }) => {
    const { db, hospitalId, session } = context;
    assertApprover(session.user.id, input.approvedBy);
    const encounter = await loadEncounter(db, hospitalId, input.encounterId);
    const [prior] = await db.select().from(receipts)
      .where(or(eq(receipts.requestId, input.requestId), and(eq(receipts.kind, "discharge"), eq(receipts.encounterId, input.encounterId))));
    if (prior && (prior.encounterId !== input.encounterId || prior.kind !== "discharge")) throw new ORPCError("CONFLICT", { message: `Request ${input.requestId} was used for another action` });
    if (prior) return prior;

    // The patient's own plan, from their record and this visit's rows: its blockers and take-home list are what the server checks.
    const { patient, admission, gl, person, plan, waits } = await visitPlan(db, encounter);
    if (!admission) throw new ORPCError("PRECONDITION_FAILED", { message: "The patient is not admitted" });
    const saved: DischargeState = { ...EMPTY_DISCHARGE, ...encounter.state.discharge, glReceived: !gl || gl.status === "received" };
    // The check-in days go with the discharge: the ones sent now, else the saved pick, else the condition's suggestion.
    const state: DischargeState = { ...saved, checkInDays: input.checkInDays ?? checkInDaysOf(saved, plan) };
    // The context's clock, so the check-in schedule follows a test's (or the demo's) day, not the wall clock.
    const at = clockOf(context);
    // A bed nobody marked fit has no wait to count from, so its receipt claims no minutes saved.
    const fitAt = admission.fitAt ?? undefined;
    const openFindings = await listFindings(db, hospitalId, at, and(eq(findings.encounterId, input.encounterId), eq(findings.status, "open"))); // lane F6
    // The domain guard decides; the refusal carries the blocked checks so the app can show them.
    const decision = decideDischarge(state, plan, input, fitAt, at, openFindings, waits);
    if (decision.status === "refused") throw new ORPCError("PRECONDITION_FAILED", {
      message: decision.reason === "unapproved" ? "Discharge needs a named approver" : "Discharge is blocked",
      data: { reason: decision.reason, blockers: dischargeChecks(state, plan, openFindings, waits).filter(c => c.status === "blocked") },
    });
    const { savedMinutes } = decision;
    const followUps = dischargeTasks(person, state, plan, at);
    await db.insert(tasks).values(followUps.map(t => ({
      id: crypto.randomUUID(), hospitalId: hospitalId,encounterId: input.encounterId,
      kind: "discharge" as const, title: t.title, owner: t.owner, due: t.due, idempotencyKey: `discharge:${input.encounterId}:${t.id}`,
    }))).onConflictDoNothing();
    await scheduleCheckIns(db, hospitalId, patient, input.encounterId, state.language, at, state.checkInDays);
    await db.update(admissions).set({ dischargedAt: at }).where(and(eq(admissions.id, admission.id), isNull(admissions.dischargedAt)));
    // The leaflet the approver read goes home with the patient: the model's latest draft in the discharge language
    // (discharge.draft). Sona Care shows these approved words, never a new draft. With no model draft nothing was read,
    // so no leaflet is recorded as approved.
    const [draft] = await db.select({ id: provenance.id, output: provenance.output, model: provenance.model }).from(provenance)
      .where(and(modelDraft(input.encounterId), sql`${provenance.output}->>'language' = ${state.language}`))
      .orderBy(desc(provenance.createdAt)).limit(1);
    if (draft) await db.update(provenance).set({ approvedBy: input.approvedBy }).where(eq(provenance.id, draft.id));
    const text = (draft?.output as { leaflet?: string } | undefined)?.leaflet;
    const leaflet: ApprovedLeaflet | undefined = text ? { language: state.language, text, model: draft!.model, approvedBy: staffName(session.user.name, context.role), approvedAt: at.toISOString() } : undefined;
    const discharged = { ...state, dischargedAt: at.toISOString(), savedMinutes, leaflet };
    // Merged in place so a concurrent edit is neither lost nor needed to bump the revision.
    await db.update(encounters).set({ state: sql`jsonb_set(${encounters.state}, '{discharge}', ${JSON.stringify(discharged)}::jsonb)` }).where(eq(encounters.id, input.encounterId));
    // Sona's follow-up starts: the visit's check-in agent plans the first check-in and wakes itself for it.
    await context.followUps?.tick(hospitalId, input.encounterId).catch(error => console.error("check-in agent failed", error));

    await db.insert(receipts).values({
      id: crypto.randomUUID(), kind: "discharge", encounterId: input.encounterId, requestId: input.requestId, revision: encounter.revision, approvedBy: input.approvedBy,
      payload: { dischargedAt: discharged.dischargedAt, savedMinutes, typicalWaitMinutes: TYPICAL_WAIT_MINUTES, typicalWaitSynthetic: true, taskIds: followUps.map(t => t.id) },
    }).onConflictDoNothing();
    const [receipt] = await db.select().from(receipts).where(eq(receipts.requestId, input.requestId));
    return receipt!;
  }),
};
