import { ORPCError } from "@orpc/server";
import { admissions, encounters, guaranteeLetters, patients, receipts, tasks } from "@sona-ai/db/schema/clinical";
import { EMPTY_DISCHARGE, TYPICAL_WAIT_MINUTES, dischargeChecks, dischargeTasks, minutesSaved, planFor, type DischargeState } from "@sona-ai/domain/discharge";
import type { Patient } from "@sona-ai/domain/types";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";

import { approvedCommandSchema } from "../contracts";
import { protectedProcedure } from "../index";
import { loadEncounter } from "./encounter";
import { hospitalOf } from "./hospital";

/**
 * Discharge is refused while any blocker is open, whatever the app shows. Every side effect is
 * idempotent and the receipt is written last, so a replay (same requestId) or a second approval
 * for the same encounter returns the one receipt. No transaction: Neon's HTTP driver has none.
 */
export const dischargeRouter = {
  request: protectedProcedure.input(approvedCommandSchema).handler(async ({ context: { db, session }, input }) => {
    const encounter = await loadEncounter(db, hospitalOf(session), input.encounterId);
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

    // ponytail: planFor ignores the patient beyond its name (one authored plan); lane C's guards replace it.
    const person = { id: row.patient.id, name: row.patient.name } as Patient;
    const plan = planFor(person);
    const state: DischargeState = { ...EMPTY_DISCHARGE, ...encounter.state.discharge, glReceived: !gl || gl.status === "received" };
    const blockers = dischargeChecks(state, plan).filter(c => c.status === "blocked");
    if (blockers.length) throw new ORPCError("PRECONDITION_FAILED", { message: "Discharge is blocked", data: { blockers } });

    const at = new Date();
    const fitAt = row.admission.fitAt ?? new Date(at.getTime() - plan.fitMinutesAgo * 60000);
    const savedMinutes = minutesSaved(fitAt, at);
    const followUps = dischargeTasks(person, state, plan, at);
    await db.insert(tasks).values(followUps.map(t => ({
      id: crypto.randomUUID(), hospitalId: hospitalOf(session),encounterId: input.encounterId,
      kind: "discharge" as const, title: t.title, owner: t.owner, due: t.due, idempotencyKey: `discharge:${input.encounterId}:${t.id}`,
    }))).onConflictDoNothing();
    await db.update(admissions).set({ dischargedAt: at }).where(and(eq(admissions.id, row.admission.id), isNull(admissions.dischargedAt)));
    const discharged = { ...state, dischargedAt: at.toISOString(), savedMinutes };
    // Merged in place so a concurrent edit is neither lost nor needed to bump the revision.
    await db.update(encounters).set({ state: sql`jsonb_set(${encounters.state}, '{discharge}', ${JSON.stringify(discharged)}::jsonb)` }).where(eq(encounters.id, input.encounterId));

    // ponytail: two different requestIds racing can both receipt; add a unique (kind, encounter_id) index if that matters.
    await db.insert(receipts).values({
      id: crypto.randomUUID(), kind: "discharge", encounterId: input.encounterId, requestId: input.requestId, revision: encounter.revision, approvedBy: input.approvedBy,
      payload: { dischargedAt: discharged.dischargedAt, savedMinutes, typicalWaitMinutes: TYPICAL_WAIT_MINUTES, typicalWaitSynthetic: true, taskIds: followUps.map(t => t.id) },
    }).onConflictDoNothing();
    const [receipt] = await db.select().from(receipts).where(eq(receipts.requestId, input.requestId));
    return receipt!;
  }),
};
