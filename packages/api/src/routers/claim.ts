import { ORPCError } from "@orpc/server";
import { claims, encounters, patients, receipts } from "@sona-ai/db/schema/clinical";
import { CODES, EMPTY_CLAIM, ESTIMATE, INSURER, decideClaimSend, type ClaimState } from "@sona-ai/domain/claim";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { claimUpdateSchema, approvedCommandSchema } from "../contracts";
import { newReviewToken, reviewUrl } from "../insurer";
import { clockOf } from "../context";
import { protectedProcedure } from "../index";
import { assertApprover } from "./hospital";
import { loadEncounter } from "./encounter";

/**
 * Final guarantee letter: refused while an insurer criterion is open or nobody approved it, sent
 * once per requestId with a review link the insurer approves or queries on (see ../insurer). Approval
 * marks the guarantee letter received, which is what the discharge checks.
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
    assertApprover(context.session.user.id, input.approvedBy);
    const { db, hospitalId } = context;
    const encounter = await loadEncounter(db, hospitalId, input.encounterId);
    const [prior] = await db.select().from(receipts).where(eq(receipts.requestId, input.requestId));
    if (prior && (prior.encounterId !== input.encounterId || prior.kind !== "claim")) throw new ORPCError("CONFLICT", { message: `Request ${input.requestId} was used for another action` });
    if (prior) return prior;

    const at = clockOf(context);
    const state: ClaimState = { ...EMPTY_CLAIM, ...(encounter.state.claim ?? {}) };
    const decision = decideClaimSend(state, input, at);
    if (decision.status === "refused") throw new ORPCError("PRECONDITION_FAILED", { message: "The claim is not ready to send", data: { reason: decision.reason, open: decision.open } });

    // A fresh link each send; a claim the insurer queried goes back to them once the doctor sends again.
    const token = newReviewToken();
    await db.insert(claims).values({
      id: claimId(input.encounterId), encounterId: input.encounterId, insurer: INSURER, status: "sent", estimateCents: ESTIMATE_CENTS,
      codes: CODES.map(c => ({ code: c.code, evidence: c.evidence })), sentAt: at, reviewToken: token,
    }).onConflictDoUpdate({ target: claims.id, set: { status: "sent", sentAt: at, reviewToken: token, decidedAt: null, insurerNote: null }, setWhere: ne(claims.status, "approved") });
    // The email is a courtesy: a failure is recorded on the receipt, never a failed send (the app shows the link too).
    let emailed = false;
    if (context.mail && context.publicUrl) {
      const [person] = await db.select({ name: patients.name }).from(patients).innerJoin(encounters, eq(encounters.patientId, patients.id)).where(eq(encounters.id, input.encounterId));
      const link = reviewUrl(context.publicUrl, token);
      try {
        await context.mail.send({ from: context.mail.from, to: context.mail.insurer, subject: `Final guarantee letter · ${person?.name ?? "patient"} · ${ESTIMATE} (synthetic)`,
          text: `A final guarantee letter request is ready for review (synthetic demo, fictional insurer).\n\nReview, approve or query it here: ${link}\n\nThe link expires in 7 days.` });
        emailed = true;
      } catch { emailed = false; }
    }
    await db.insert(receipts).values({
      id: crypto.randomUUID(), kind: "claim", encounterId: input.encounterId, requestId: input.requestId, revision: encounter.revision,
      approvedBy: input.approvedBy, payload: { sentAt: decision.sentAt, insurer: INSURER, estimateCents: ESTIMATE_CENTS, reviewLink: true, emailed },
    }).onConflictDoNothing();
    const [receipt] = await db.select().from(receipts).where(and(eq(receipts.kind, "claim"), eq(receipts.encounterId, input.encounterId)));
    return receipt!;
  }),

  /** Polled by the app: the insurer's decision, the review link while it is with them, and their question if they queried. */
  status: protectedProcedure.input(z.object({ encounterId: z.string().min(1) })).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    await loadEncounter(db, hospitalId, input.encounterId);
    const [claim] = await db.select().from(claims).where(eq(claims.id, claimId(input.encounterId)));
    if (!claim) return { status: "draft" as const };
    const link = claim.reviewToken && context.publicUrl && claim.status === "sent" ? reviewUrl(context.publicUrl, claim.reviewToken) : undefined;
    return { status: claim.status, approvedAt: claim.approvedAt?.toISOString(), reviewUrl: link, query: claim.insurerNote ?? undefined };
  }),
};
