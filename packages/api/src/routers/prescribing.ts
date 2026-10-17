import { ORPCError } from "@orpc/server";
import { user } from "@sona-ai/db/schema/auth";
import { receipts } from "@sona-ai/db/schema/clinical";
import { effectivePatient, getPrescriptionChecks, regimenOf } from "@sona-ai/domain/prescribing";
import type { Encounter } from "@sona-ai/domain/types";
import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod";

import { approvedCommandSchema, type ApprovedCommand } from "../contracts";
import type { Context } from "../context";
import { protectedProcedure } from "../index";
import { encounterRouter, loadEncounter, visitOf } from "./encounter";
import { assertApprover } from "./hospital";

/**
 * The prescribe card's server steps. The review is recorded at the revision it ran against
 * (encounter.recordReview's rule, which also has Sona check an order no dose rule covers). Prescribing runs
 * the same domain checks on the server's encounter state and patient record, whatever the app shows, and is
 * refused while any of them is blocked; a warning is the doctor's to weigh. The receipt holds the regimen the clinician entered for this visit; it is a record here,
 * sent to no pharmacy system. (`simulate` is the route's first name, kept so callers need not change.)
 */
export const prescribingRouter = {
  review: encounterRouter.recordReview,
  simulate: protectedProcedure.input(approvedCommandSchema).handler(({ context, input }) => issue(context, input)),
  /**
   * Amends the latest receipt: the record was edited and reviewed again since (a newer revision), the
   * same eleven checks run on it, and the new receipt names the one it supersedes and why. The earlier
   * receipt never changes.
   */
  amend: protectedProcedure.input(approvedCommandSchema.extend({ reason: z.string().trim().min(1).max(500) }))
    .handler(({ context, input }) => issue(context, input, input.reason)),
};

/**
 * One prescription receipt, replay-safe by request; with `reason`, the amendment of the latest one. `approvedByName` is
 * the approver's display name, read beside the row (which holds the user id), so the app's audit line names a person.
 */
async function issue(context: Pick<Context, "db"> & { hospitalId: string; session: { user: { id: string; name?: string } } }, input: ApprovedCommand, reason?: string) {
  const receipt = await write(context, input, reason);
  // The caller's own name is in the session; a replay may return a receipt a colleague approved, read from their account.
  const approvedByName = receipt.approvedBy === context.session.user.id ? context.session.user.name
    : receipt.approvedBy ? (await context.db.select({ name: user.name }).from(user).where(eq(user.id, receipt.approvedBy)))[0]?.name : undefined;
  return { ...receipt, approvedByName };
}

async function write({ db, hospitalId, session }: Pick<Context, "db"> & { hospitalId: string; session: { user: { id: string } } }, input: ApprovedCommand, reason?: string) {
  assertApprover(session.user.id, input.approvedBy);
  if (!input.approvedBy.trim()) throw new ORPCError("PRECONDITION_FAILED", { message: "The prescription needs a named approver", data: { open: [] } });
  const encounter = await loadEncounter(db, hospitalId, input.encounterId);
  // One receipt per request and per revision: a replay, or a second tap at the same revision, returns it.
  const [prior] = await db.select().from(receipts).where(or(eq(receipts.requestId, input.requestId),
    and(eq(receipts.kind, "prescription"), eq(receipts.encounterId, input.encounterId), eq(receipts.revision, encounter.revision))));
  if (prior && (prior.encounterId !== input.encounterId || prior.kind !== "prescription")) throw new ORPCError("CONFLICT", { message: `Request ${input.requestId} was used for another action` });
  if (prior && (!reason || prior.requestId === input.requestId)) return prior;
  // An amendment needs a receipt to amend, from before this revision: nothing new was recorded since one at this revision.
  if (prior) throw new ORPCError("PRECONDITION_FAILED", { message: "Nothing has changed since the last prescription; amend the record and review it first", data: { open: [] } });
  const [latest] = reason ? await db.select({ requestId: receipts.requestId }).from(receipts)
    .where(and(eq(receipts.kind, "prescription"), eq(receipts.encounterId, input.encounterId))).orderBy(desc(receipts.revision)).limit(1) : [];
  if (reason && !latest) throw new ORPCError("PRECONDITION_FAILED", { message: "There is no prescription to amend", data: { open: [] } });

  // The server's own record of the patient, with what the clinician recorded on this visit laid over it (an allergy, a corrected complaint).
  const { patient: record } = await visitOf(db, hospitalId, input.encounterId);
  const visit = { ...encounter.state, revision: encounter.revision } as Encounter;
  const patient = effectivePatient({ ...record, sources: record.sources ?? [] }, visit);
  const checks = getPrescriptionChecks(visit, patient);
  const open = checks.filter(c => c.status === "blocked").map(c => c.label);
  if (open.length) throw new ORPCError("PRECONDITION_FAILED", { message: reason ? "The amended prescription is blocked" : "The prescription is blocked", data: { open } });

  await db.insert(receipts).values({
    id: crypto.randomUUID(), kind: "prescription", encounterId: input.encounterId, requestId: input.requestId, revision: encounter.revision, approvedBy: input.approvedBy,
    // The regimen check passed, so the visit holds a whole regimen: the one entered for this patient, never a stock one.
    // Warnings were the doctor's to weigh, and placing the order over them is recorded beside it, with the model that raised them.
    payload: { ...regimenOf(visit, patient)!, checks: checks.filter(c => c.status === "passed").map(c => c.label), warnings: checks.filter(c => c.status === "warning").map(c => c.label),
      ...checks.some(c => c.by === "sona") && { checkedBy: visit.sonaCheck?.model ?? "none: Sona could not check it" }, transmitted: false, dispensed: false, ...latest ? { amendment: { reason, supersedes: latest.requestId } } : {} },
  }).onConflictDoNothing();
  const [receipt] = await db.select().from(receipts).where(eq(receipts.requestId, input.requestId));
  return receipt!;
}
