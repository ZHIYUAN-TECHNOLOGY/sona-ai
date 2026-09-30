import { ORPCError } from "@orpc/server";
import { admissions, encounters, findings, guaranteeLetters, labResults, patients, provenance, receipts, tasks } from "@sona-ai/db/schema/clinical";
import { EMPTY_DISCHARGE, TYPICAL_WAIT_MINUTES, checkInDaysOf, decideDischarge, dischargeChecks, dischargeTasks, planFor, type DischargeState, type Language, type Wait } from "@sona-ai/domain/discharge";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { clockOf } from "../context";
import { dischargeRequestSchema, dischargeUpdateSchema } from "../contracts";
import { protectedProcedure } from "../index";
import { stubModels } from "../models";
import { listFindings } from "./findings";
import { assertApprover } from "./hospital";
import { loadEncounter, logAnswer, recordOf, recordSources, visitOf } from "./encounter";
import { scheduleCheckIns } from "./check-ins";

/** The patient leaflet as approved at discharge, in the discharge language; kept in the visit's discharge state. */
export type ApprovedLeaflet = { language: Language; text: string };

/**
 * Discharge is refused while any blocker is open, whatever the app shows. Every side effect is
 * idempotent and the receipt is written last, so a replay (same requestId) or a second approval
 * for the same encounter returns the one receipt. No transaction: Neon's HTTP driver has none.
 */
export const dischargeRouter = {
  /** The summary and the leaflet in the chosen language, drafted from the patient's own record (a labelled fixture until Gemma is on). */
  draft: protectedProcedure.input(z.object({ encounterId: z.string().min(1), language: z.enum(["ms", "en", "zh"]) })).handler(async ({ context, input }) => {
    const { patient } = await visitOf(context.db, context.hospitalId, input.encounterId);
    const answer = await (context.models ?? stubModels).draftDischarge({ patient, language: input.language });
    return logAnswer(context.db, input.encounterId, "discharge-draft", { ...answer, language: input.language }, recordSources(patient));
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

    const [row] = await db.select({ patient: patients, admission: admissions }).from(encounters)
      .innerJoin(patients, eq(patients.id, encounters.patientId))
      .innerJoin(admissions, eq(admissions.patientId, patients.id))
      .where(eq(encounters.id, input.encounterId)).orderBy(desc(admissions.id)).limit(1);
    if (!row) throw new ORPCError("PRECONDITION_FAILED", { message: "The patient is not admitted" });
    const [gl] = await db.select().from(guaranteeLetters).where(eq(guaranteeLetters.admissionId, row.admission.id));

    // The patient's own plan: its blockers, follow-up and take-home list are what the server checks.
    const person = recordOf(row.patient, input.encounterId);
    const plan = planFor({ ...person, bed: row.admission.bed });
    const saved: DischargeState = { ...EMPTY_DISCHARGE, ...encounter.state.discharge, glReceived: !gl || gl.status === "received" };
    // The check-in days go with the discharge: the ones sent now, else the saved pick, else the condition's suggestion.
    const state: DischargeState = { ...saved, checkInDays: input.checkInDays ?? checkInDaysOf(saved, plan) };
    // The context's clock, so the check-in schedule follows a test's (or the demo's) day, not the wall clock.
    const at = clockOf(context);
    const fitAt = row.admission.fitAt ?? new Date(at.getTime() - plan.fitMinutesAgo * 60000);
    const openFindings = await listFindings(db, hospitalId, at, and(eq(findings.encounterId, input.encounterId), eq(findings.status, "open"))); // lane F6
    // The rest of what the ward shows as blocking this bed (ward.ts, bedBlockers): pending results and a ride still to arrange.
    const pending = await db.select({ id: labResults.id, test: labResults.test }).from(labResults).where(and(eq(labResults.patientId, row.patient.id), eq(labResults.flag, "pending")));
    const transport = (encounter.state as { transport?: { label: string; detail: string } }).transport;
    const waits: Wait[] = [
      ...pending.map(r => ({ id: `result-${r.id}`, label: r.test, detail: "Pending" })),
      ...(transport ? [{ id: "transport", ...transport }] : []),
    ];
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
    await scheduleCheckIns(db, hospitalId, row.patient, input.encounterId, state.language, at, state.checkInDays);
    await db.update(admissions).set({ dischargedAt: at }).where(and(eq(admissions.id, row.admission.id), isNull(admissions.dischargedAt)));
    // The leaflet the approver read goes home with the patient: the latest draft in the discharge language
    // (discharge.draft), else the authored one. Sona Care shows these approved words, never a new draft.
    const [draft] = await db.select({ id: provenance.id, output: provenance.output }).from(provenance)
      .where(and(eq(provenance.encounterId, input.encounterId), eq(provenance.kind, "discharge-draft"), sql`${provenance.output}->>'language' = ${state.language}`))
      .orderBy(desc(provenance.createdAt)).limit(1);
    if (draft) await db.update(provenance).set({ approvedBy: input.approvedBy }).where(eq(provenance.id, draft.id));
    const leaflet: ApprovedLeaflet = { language: state.language, text: (draft?.output as { leaflet?: string } | undefined)?.leaflet || plan.leaflet[state.language] };
    const discharged = { ...state, dischargedAt: at.toISOString(), savedMinutes, leaflet };
    // Merged in place so a concurrent edit is neither lost nor needed to bump the revision.
    await db.update(encounters).set({ state: sql`jsonb_set(${encounters.state}, '{discharge}', ${JSON.stringify(discharged)}::jsonb)` }).where(eq(encounters.id, input.encounterId));

    await db.insert(receipts).values({
      id: crypto.randomUUID(), kind: "discharge", encounterId: input.encounterId, requestId: input.requestId, revision: encounter.revision, approvedBy: input.approvedBy,
      payload: { dischargedAt: discharged.dischargedAt, savedMinutes, typicalWaitMinutes: TYPICAL_WAIT_MINUTES, typicalWaitSynthetic: true, taskIds: followUps.map(t => t.id) },
    }).onConflictDoNothing();
    const [receipt] = await db.select().from(receipts).where(eq(receipts.requestId, input.requestId));
    return receipt!;
  }),
};
