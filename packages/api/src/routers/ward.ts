import { ORPCError } from "@orpc/server";
import { DEMO_HOSPITAL } from "@sona-ai/db/demo";
import { admissions, claims, encounters, findings, guaranteeLetters, labResults, patients, tasks } from "@sona-ai/db/schema/clinical";
import { admittedBed, bedBlockers, byUrgency, freedBed, WARD_FIXTURE, type Bed, type Owner, type WardRecord } from "@sona-ai/domain/ward";
import { and, asc, eq } from "drizzle-orm";

import { assignOwnerSchema } from "../contracts";
import type { Context } from "../context";
import { protectedProcedure } from "../index";
import { stubModels } from "../models";
import { logAnswer } from "./encounter";

/**
 * Every bed on the hospital's ward, in the shape the app draws: each admitted patient's ward record with
 * blockers derived from their rows (never from the authored ward), a bed whose patient went home as freed.
 */
export async function liveBeds(db: Context["db"], hospitalId: string): Promise<(Bed & { admissionId?: string })[]> {
  const rows = await db.select({ admission: admissions, patient: patients, gl: guaranteeLetters, encounter: encounters }).from(admissions)
    .innerJoin(patients, eq(patients.id, admissions.patientId))
    .leftJoin(guaranteeLetters, eq(guaranteeLetters.admissionId, admissions.id))
    .leftJoin(encounters, eq(encounters.patientId, admissions.patientId))
    .where(eq(admissions.hospitalId, hospitalId)).orderBy(asc(admissions.id));
  const occupied = new Set(rows.filter(r => !r.admission.dischargedAt).map(r => r.admission.bed));
  const beds = await Promise.all(rows.map(async ({ admission, patient, gl, encounter }) => {
    if (admission.dischargedAt) return occupied.has(admission.bed) ? [] : [{ ...freedBed(admission.bed), admissionId: admission.id }];
    const [claim] = encounter ? await db.select({ status: claims.status }).from(claims).where(eq(claims.encounterId, encounter.id)) : [];
    const pending = await db.select().from(labResults).where(and(eq(labResults.patientId, admission.patientId), eq(labResults.flag, "pending")));
    const state = encounter?.state as { discharge?: { medsConfirmed?: boolean; followUp?: string }; transport?: { label: string; detail: string } } | undefined;
    const openFindings = encounter ? await db.select({ id: findings.id, label: findings.label }).from(findings).where(and(eq(findings.encounterId, encounter.id), eq(findings.status, "open"))).orderBy(asc(findings.riskBand)) : [];
    const ward = (patient.record as { ward?: WardRecord }).ward ?? { status: "fit" };
    const blockers = bedBlockers({
      admissionId: admission.id, gl: gl ? { status: gl.status, claimStatus: claim?.status } : undefined,
      medsConfirmed: Boolean(state?.discharge?.medsConfirmed), followUpBooked: Boolean(state?.discharge?.followUp),
      pendingResults: pending.map(r => ({ id: r.id, test: r.test })), openFindings, transport: state?.transport, fit: ward.status === "fit",
    });
    return [{ ...admittedBed(admission.bed, patient, ward, blockers), admissionId: admission.id }];
  }));
  // ponytail: the demo ward's empty beds stay authored until a bed system says which beds exist.
  const empty = hospitalId === DEMO_HOSPITAL ? WARD_FIXTURE.filter(b => !b.name && !occupied.has(b.bed)) : [];
  // One tile per bed: a bed freed more than once shows once.
  return [...new Map([...beds.flat(), ...empty].map(b => [b.bed, b])).values()].sort(byUrgency);
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
  /** The three-line huddle brief over the live ward and its owners (the app keeps its local rule as a fallback). */
  huddle: protectedProcedure.handler(async ({ context }) => {
    const { db, hospitalId } = context;
    const beds = await liveBeds(db, hospitalId);
    const owned = await db.select({ sourceId: tasks.sourceId, owner: tasks.owner }).from(tasks).where(and(eq(tasks.hospitalId, hospitalId), eq(tasks.kind, "blocker-owner")));
    const owners = Object.fromEntries(owned.filter(t => t.sourceId).map(t => [t.sourceId!, t.owner as Owner]));
    const answer = await (context.models ?? stubModels).huddleBrief({ beds, owners });
    return logAnswer(db, null, "huddle-brief", answer, beds.flatMap(b => b.blockers.map(x => x.id)));
  }),
};
