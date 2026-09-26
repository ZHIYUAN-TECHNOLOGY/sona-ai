import { ORPCError } from "@orpc/server";
import { encounters } from "@sona-ai/db/schema/clinical";
import type { Encounter } from "@sona-ai/domain/types";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { encounterEditSchema, recordReviewSchema, type EncounterEdit, type RecordReview } from "../contracts";
import type { Context } from "../context";
import { protectedProcedure } from "../index";

/**
 * Encounter state on the server. Postgres holds the snapshot and is the arbiter of revisions: every
 * write is conditional on the revision the caller last saw, so the Worker and the encounter's
 * Durable Object can never both win. An eligibility or medicine edit bumps the revision and
 * invalidates the medication review, as reviseEncounter does in the app.
 */
export type EncounterState = Omit<Partial<Encounter>, "revision">;
export type EncounterSnapshot = { encounterId: string; revision: number; state: EncounterState };
type Db = Context["db"];



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

export const encounterRouter = {
  get: protectedProcedure.input(z.object({ encounterId: z.string().min(1) }))
    .handler(({ context, input }) => loadEncounter(context.db, context.hospitalId, input.encounterId)),
  // Through the encounter's Durable Object when the Worker provides it, so its live state never goes stale.
  edit: protectedProcedure.input(encounterEditSchema).handler(async ({ context, input }) => {
    const { hospitalId } = context;
    if (context.encounters) return context.encounters.edit(hospitalId, input);
    const current = await loadEncounter(context.db, hospitalId, input.encounterId);
    return saveEncounter(context.db, hospitalId, current.revision, applyEdit(current, input));
  }),
  recordReview: protectedProcedure.input(recordReviewSchema).handler(async ({ context, input }) => {
    const { hospitalId } = context;
    if (context.encounters) return context.encounters.recordReview(hospitalId, input);
    const current = await loadEncounter(context.db, hospitalId, input.encounterId);
    return saveEncounter(context.db, hospitalId, current.revision, applyReview(current, input));
  }),
};
