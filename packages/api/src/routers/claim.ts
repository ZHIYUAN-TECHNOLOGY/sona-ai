import { ORPCError } from "@orpc/server";
import { claims, encounters, icd10Codes, notes, patients, provenance, receipts } from "@sona-ai/db/schema/clinical";
import { EMPTY_CLAIM, ESTIMATE, INSURER, decideClaimSend, noteFor, type ClaimState, type Code, type Sentence } from "@sona-ai/domain/claim";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { claimUpdateSchema, approvedCommandSchema } from "../contracts";
import { newReviewToken, reviewUrl } from "../insurer";
import { clockOf, type Context } from "../context";
import { protectedProcedure } from "../index";
import { stubModels } from "../models";
import { assertApprover } from "./hospital";
import { loadEncounter, logAnswer, visitOf } from "./encounter";

/**
 * Final guarantee letter: refused while an insurer criterion is open or nobody approved it, sent
 * once per requestId with a review link the insurer approves or queries on (see ../insurer). Approval
 * marks the guarantee letter received, which is what the discharge checks.
 */
// ponytail: one authored estimate for the demo claim; the casemix grouper prices real claims.
const ESTIMATE_CENTS = 348_000;
const claimId = (encounterId: string) => `claim-${encounterId}`;

type Suggestion = { codes: (Code & { inTable?: boolean })[]; sentences: Sentence[] };

/**
 * Codes for the letter, suggested over the note's sentences: the latest saved note (with any fix the
 * claim added), or the claim's own note excerpt when none is saved. A code must cite one of those
 * sentences or it is dropped; each diagnosis code is looked up in the WHO ICD-10 table, and one the
 * table lacks is kept but flagged, never silently trusted.
 */
async function suggest(context: Context & { hospitalId: string }, encounterId: string) {
  const { db, hospitalId } = context;
  const { state } = await visitOf(db, hospitalId, encounterId);
  const claim: ClaimState = { ...EMPTY_CLAIM, ...(state.claim ?? {}) };
  const [saved] = await db.select({ sentences: notes.sentences }).from(notes).where(eq(notes.encounterId, encounterId)).orderBy(desc(notes.revision)).limit(1);
  const excerpt = noteFor(claim);
  const sentences: Sentence[] = saved?.sentences.length ? [...saved.sentences, ...excerpt.filter(s => s.id === "organism" || s.id === "iv")] : excerpt;
  const answer = await (context.models ?? stubModels).suggestCodes({ sentences });
  const grounded = answer.codes.filter(c => sentences.some(s => s.id === c.evidence));
  const diagnoses = grounded.filter(c => c.kind !== "Procedure").map(c => c.code);
  const known = new Set(diagnoses.length ? (await db.select({ code: icd10Codes.code }).from(icd10Codes).where(inArray(icd10Codes.code, diagnoses))).map(r => r.code) : []);
  // Procedures are not ICD-10 codes, so the table does not judge them (undefined).
  const codes = grounded.map(c => ({ ...c, inTable: c.kind === "Procedure" ? undefined : known.has(c.code) }));
  return logAnswer(db, encounterId, "claim-codes", { ...answer, codes, sentences }, codes.map(c => c.evidence));
}

/** The codes the doctor last reviewed for this visit (the latest suggestion), suggested now if none was. */
async function reviewedCodes(context: Context & { hospitalId: string }, encounterId: string): Promise<Suggestion> {
  const [last] = await context.db.select({ output: provenance.output }).from(provenance)
    .where(and(eq(provenance.encounterId, encounterId), eq(provenance.kind, "claim-codes"))).orderBy(desc(provenance.createdAt)).limit(1);
  return (last?.output as Suggestion | undefined) ?? suggest(context, encounterId);
}

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

    // Already approved: the one receipt, with no new link and no second email (a queried or unanswered claim may go again).
    const [current] = await db.select({ status: claims.status }).from(claims).where(eq(claims.id, claimId(input.encounterId)));
    const [sentBefore] = await db.select().from(receipts).where(and(eq(receipts.kind, "claim"), eq(receipts.encounterId, input.encounterId)));
    if (current?.status === "approved" && sentBefore) return sentBefore;

    const at = clockOf(context);
    const state: ClaimState = { ...EMPTY_CLAIM, ...(encounter.state.claim ?? {}) };
    const decision = decideClaimSend(state, input, at);
    if (decision.status === "refused") throw new ORPCError("PRECONDITION_FAILED", { message: "The claim is not ready to send", data: { reason: decision.reason, open: decision.open } });

    // The codes the doctor reviewed for this patient, each with the note sentence behind it, frozen into the letter.
    const reviewed = await reviewedCodes(context, input.encounterId);
    const codes = reviewed.codes.map(c => ({ code: c.code, label: c.label, kind: c.kind, evidence: c.evidence, text: reviewed.sentences.find(s => s.id === c.evidence)?.text ?? "" }));
    // A fresh link each send; a claim the insurer queried goes back to them once the doctor sends again.
    const token = newReviewToken();
    await db.insert(claims).values({
      id: claimId(input.encounterId), encounterId: input.encounterId, insurer: INSURER, status: "sent", estimateCents: ESTIMATE_CENTS,
      codes, sentAt: at, reviewToken: token,
    }).onConflictDoUpdate({ target: claims.id, set: { status: "sent", sentAt: at, reviewToken: token, codes, decidedAt: null, insurerNote: null }, setWhere: ne(claims.status, "approved") });
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

  /** Codes for the letter, each citing its note sentence (see `suggest`). */
  suggestCodes: protectedProcedure.input(z.object({ encounterId: z.string().min(1) })).handler(({ context, input }) => suggest(context, input.encounterId)),

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
