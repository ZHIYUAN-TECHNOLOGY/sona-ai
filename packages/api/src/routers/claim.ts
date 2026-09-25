import { ORPCError } from "@orpc/server";
import { admissions, claims, encounters, guaranteeLetters, receipts } from "@sona-ai/db/schema/clinical";
import { CODES, EMPTY_CLAIM, INSURER, decideClaimSend, insurerDecision, type ClaimState } from "@sona-ai/domain/claim";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { claimUpdateSchema, approvedCommandSchema } from "../contracts";
import { clockOf } from "../context";
import { protectedProcedure } from "../index";
import { loadEncounter } from "./encounter";

/**
 * Final guarantee letter: refused while an insurer criterion is open or nobody approved it, sent
 * once per requestId, then approved by the mock insurer after its fixed delay. Approval marks the
 * guarantee letter received, which is what the discharge checks.
 */
// ponytail: one authored estimate for the demo claim; the casemix grouper prices real claims.
const ESTIMATE_CENTS = 348_000;
const claimId = (encounterId: string) => `claim-${encounterId}`;

export const claimRouter = {
  update: protectedProcedure.input(claimUpdateSchema).handler(async ({ context: { db, hospitalId }, input }) => {
    const { encounterId, ...patch } = input;
    await loadEncounter(db, hospitalId, encounterId);
    await db.update(encounters)
      .set({ state: sql`jsonb_set(${encounters.state}, '{claim}', coalesce(${encounters.state}->'claim', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)`, updatedAt: new Date() })
      .where(eq(encounters.id, encounterId));
    return loadEncounter(db, hospitalId, encounterId);
  }),

  send: protectedProcedure.input(approvedCommandSchema).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    const encounter = await loadEncounter(db, hospitalId, input.encounterId);
    const [prior] = await db.select().from(receipts).where(eq(receipts.requestId, input.requestId));
    if (prior && (prior.encounterId !== input.encounterId || prior.kind !== "claim")) throw new ORPCError("CONFLICT", { message: `Request ${input.requestId} was used for another action` });
    if (prior) return prior;

    const at = clockOf(context);
    const state: ClaimState = { ...EMPTY_CLAIM, ...(encounter.state.claim ?? {}) };
    const decision = decideClaimSend(state, input, at);
    if (decision.status === "refused") throw new ORPCError("PRECONDITION_FAILED", { message: "The claim is not ready to send", data: { reason: decision.reason, open: decision.open } });

    await db.insert(claims).values({
      id: claimId(input.encounterId), encounterId: input.encounterId, insurer: INSURER, status: "sent", estimateCents: ESTIMATE_CENTS,
      codes: CODES.map(c => ({ code: c.code, evidence: c.evidence })), sentAt: at,
    }).onConflictDoNothing();
    await db.insert(receipts).values({
      id: crypto.randomUUID(), kind: "claim", encounterId: input.encounterId, requestId: input.requestId, revision: encounter.revision,
      approvedBy: input.approvedBy, payload: { sentAt: decision.sentAt, insurer: INSURER, estimateCents: ESTIMATE_CENTS, mockInsurer: true },
    }).onConflictDoNothing();
    const [receipt] = await db.select().from(receipts).where(and(eq(receipts.kind, "claim"), eq(receipts.encounterId, input.encounterId)));
    return receipt!;
  }),

  /** Polled by the app (and later by the Durable Object alarm): settles the mock insurer's decision. */
  status: protectedProcedure.input(z.object({ encounterId: z.string().min(1) })).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    await loadEncounter(db, hospitalId, input.encounterId);
    const [claim] = await db.select().from(claims).where(eq(claims.id, claimId(input.encounterId)));
    if (!claim) return { status: "draft" as const };
    if (claim.status === "approved" || !claim.sentAt) return { status: claim.status, approvedAt: claim.approvedAt?.toISOString() };
    const decision = insurerDecision(claim.sentAt, clockOf(context));
    if (decision.status === "pending") return { status: "sent" as const, approvesAt: decision.approvesAt };
    const approvedAt = new Date(decision.approvedAt);
    await db.update(claims).set({ status: "approved", approvedAt }).where(eq(claims.id, claim.id));
    const [encounter] = await db.select({ patientId: encounters.patientId }).from(encounters).where(eq(encounters.id, input.encounterId));
    const admitted = await db.select({ id: admissions.id }).from(admissions).where(eq(admissions.patientId, encounter!.patientId));
    for (const a of admitted) await db.update(guaranteeLetters).set({ status: "received", receivedAt: approvedAt }).where(eq(guaranteeLetters.admissionId, a.id));
    return { status: "approved" as const, approvedAt: decision.approvedAt };
  }),
};
