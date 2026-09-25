import { ORPCError } from "@orpc/server";
import { encounters } from "@sona-ai/db/schema/clinical";
import type { Encounter } from "@sona-ai/domain/types";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { Context } from "../context";
import { protectedProcedure } from "../index";
import { hospitalOf } from "./hospital";

/**
 * Encounter state on the server. Postgres holds the snapshot and is the arbiter of revisions: every
 * write is conditional on the revision the caller last saw, so the Worker and the encounter's
 * Durable Object can never both win. An eligibility or medicine edit bumps the revision and
 * invalidates the medication review, as reviseEncounter does in the app.
 */
export type EncounterState = Omit<Partial<Encounter>, "revision">;
export type EncounterSnapshot = { encounterId: string; revision: number; state: EncounterState };
type Db = Context["db"];

const unknownYesNo = z.enum(["unknown", "no", "yes"]);
// Not in contracts.ts yet: the edits that change prescribing eligibility or the medicine list.
export const encounterEditSchema = z.object({
  encounterId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
  prescriptionInputs: z.object({ weightKg: z.string(), liverDisease: unknownYesNo, kidneyDisease: unknownYesNo, alcoholRisk: unknownYesNo, paracetamolAllergy: unknownYesNo }).optional(),
  medicationEntries: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), ingredient: z.string(), formulation: z.string(), confirmed: z.boolean() })).optional(),
  proposedMedicine: z.string().optional(),
}).refine(e => e.prescriptionInputs || e.medicationEntries || e.proposedMedicine !== undefined, "An edit changes eligibility or medicines");
export type EncounterEdit = z.infer<typeof encounterEditSchema>;

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
    .handler(({ context, input }) => loadEncounter(context.db, hospitalOf(context.session), input.encounterId)),
  // ponytail: writes Postgres directly; route through the EncounterState Durable Object once the agent lives there.
  edit: protectedProcedure.input(encounterEditSchema).handler(async ({ context, input }) => {
    const hospitalId = hospitalOf(context.session);
    const current = await loadEncounter(context.db, hospitalId, input.encounterId);
    return saveEncounter(context.db, hospitalId, current.revision, applyEdit(current, input));
  }),
};
