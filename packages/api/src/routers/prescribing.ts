import { ORPCError } from "@orpc/server";
import { encounters, patients, receipts } from "@sona-ai/db/schema/clinical";
import { getPrescriptionChecks, simulatedRegimen } from "@sona-ai/domain/prescribing";
import type { Encounter, Patient } from "@sona-ai/domain/types";
import { and, eq, or } from "drizzle-orm";

import { approvedCommandSchema } from "../contracts";
import { protectedProcedure } from "../index";
import { encounterRouter, loadEncounter } from "./encounter";
import { assertApprover } from "./hospital";

/**
 * The prescribe card's two server steps. The review itself is the authored fixture; only its
 * recording reaches the server, at the revision it ran against (encounter.recordReview's rule).
 * The simulation runs the same eleven domain checks on the server's encounter state and patient
 * row, whatever the app shows, and is refused while any of them is blocked.
 */
export const prescribingRouter = {
  review: encounterRouter.recordReview,
  simulate: protectedProcedure.input(approvedCommandSchema).handler(async ({ context: { db, hospitalId, session }, input }) => {
    assertApprover(session.user.id, input.approvedBy);
    if (!input.approvedBy.trim()) throw new ORPCError("PRECONDITION_FAILED", { message: "The prescription needs a named approver", data: { open: [] } });
    const encounter = await loadEncounter(db, hospitalId, input.encounterId);
    // One receipt per request and per revision: a replay, or a second tap at the same revision, returns it.
    const [prior] = await db.select().from(receipts).where(or(eq(receipts.requestId, input.requestId),
      and(eq(receipts.kind, "prescription"), eq(receipts.encounterId, input.encounterId), eq(receipts.revision, encounter.revision))));
    if (prior && (prior.encounterId !== input.encounterId || prior.kind !== "prescription")) throw new ORPCError("CONFLICT", { message: `Request ${input.requestId} was used for another action` });
    if (prior) return prior;

    const [row] = await db.select({ patient: patients }).from(encounters).innerJoin(patients, eq(patients.id, encounters.patientId)).where(eq(encounters.id, input.encounterId));
    // ponytail: the reported medicines live in the app's fixtures; the server knows only those the doctor confirmed (medicationEntries).
    const patient = { ...row!.patient, medicines: (row!.patient.record as { medicines?: string[] }).medicines ?? [] } as unknown as Patient;
    const checks = getPrescriptionChecks({ ...encounter.state, revision: encounter.revision } as Encounter, patient);
    const open = checks.filter(c => c.status === "blocked").map(c => c.label);
    if (open.length) throw new ORPCError("PRECONDITION_FAILED", { message: "The prescription is blocked", data: { open } });

    await db.insert(receipts).values({
      id: crypto.randomUUID(), kind: "prescription", encounterId: input.encounterId, requestId: input.requestId, revision: encounter.revision, approvedBy: input.approvedBy,
      payload: { ...simulatedRegimen, checks: checks.map(c => c.label), simulated: true, dispensed: false },
    }).onConflictDoNothing();
    const [receipt] = await db.select().from(receipts).where(eq(receipts.requestId, input.requestId));
    return receipt!;
  }),
};
