import { ORPCError } from "@orpc/server";
import { admissions, claims, encounters, findings, guaranteeLetters, labResults, tasks } from "@sona-ai/db/schema/clinical";
import { bedBlockers } from "@sona-ai/domain/ward";
import { and, asc, eq, isNull } from "drizzle-orm";

import { assignOwnerSchema } from "../contracts";
import type { Context } from "../context";
import { protectedProcedure } from "../index";

/** Each admitted bed's current blockers, derived from its rows (never from the authored ward). */
export async function liveBeds(db: Context["db"], hospitalId: string) {
  const rows = await db.select({ admission: admissions, gl: guaranteeLetters, encounter: encounters }).from(admissions)
    .leftJoin(guaranteeLetters, eq(guaranteeLetters.admissionId, admissions.id))
    .leftJoin(encounters, eq(encounters.patientId, admissions.patientId))
    .where(and(eq(admissions.hospitalId, hospitalId), isNull(admissions.dischargedAt)));
  return Promise.all(rows.map(async ({ admission, gl, encounter }) => {
    const [claim] = encounter ? await db.select({ status: claims.status }).from(claims).where(eq(claims.encounterId, encounter.id)) : [];
    const pending = await db.select().from(labResults).where(and(eq(labResults.patientId, admission.patientId), eq(labResults.flag, "pending")));
    const discharge = (encounter?.state as { discharge?: { medsConfirmed?: boolean; followUp?: string } } | undefined)?.discharge;
    const openFindings = encounter ? await db.select({ id: findings.id, label: findings.label }).from(findings).where(and(eq(findings.encounterId, encounter.id), eq(findings.status, "open"))).orderBy(asc(findings.riskBand)) : [];
    const blockers = bedBlockers({
      admissionId: admission.id, gl: gl ? { status: gl.status, claimStatus: claim?.status } : undefined,
      medsConfirmed: Boolean(discharge?.medsConfirmed), followUpBooked: Boolean(discharge?.followUp),
      pendingResults: pending.map(r => ({ id: r.id, test: r.test })), openFindings,
    });
    return { bed: admission.bed, admissionId: admission.id, blockers };
  }));
}

export const wardRouter = {
  assignOwner: protectedProcedure.input(assignOwnerSchema).handler(async ({ context: { db, hospitalId }, input }) => {
    const beds = await liveBeds(db, hospitalId);
    const bed = beds.find(b => b.blockers.some(x => x.id === input.blockerId));
    const blocker = bed?.blockers.find(x => x.id === input.blockerId);
    if (!bed || !blocker) throw new ORPCError("NOT_FOUND", { message: `No open ward blocker ${input.blockerId}` });
    const [task] = await db.insert(tasks)
      .values({ id: crypto.randomUUID(), hospitalId, kind: "blocker-owner", title: `${bed.bed}: ${blocker.label}`, owner: input.owner, sourceId: blocker.id, idempotencyKey: `blocker-owner:${hospitalId}:${blocker.id}` })
      .onConflictDoUpdate({ target: tasks.idempotencyKey, set: { owner: input.owner } })
      .returning();
    return task!;
  }),
  beds: protectedProcedure.handler(({ context: { db, hospitalId } }) => liveBeds(db, hospitalId)),
};
