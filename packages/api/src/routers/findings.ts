import { ORPCError } from "@orpc/server";
import { appointments, encounters, findings, followUpRules, patients, provenance, tasks } from "@sona-ai/db/schema/clinical";
import { dueDate, findingLine, isOverdue, ruleFor } from "@sona-ai/domain/findings";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { findingDismissSchema, findingTrackSchema } from "../contracts";
import { clockOf, type Context } from "../context";
import { stubModels } from "../models";
import { protectedProcedure } from "../index";

/**
 * Demo flow 6: findings beyond the question an X-ray was taken for. The model only says what and
 * where; the risk band and interval are looked up from follow_up_rules. Every row is labelled
 * unvalidated, and its source says whether a fixture or which model produced it.
 */
export async function listFindings(db: Context["db"], hospitalId: string, at: Date, where?: SQL) {
  const rows = await db.select({ finding: findings, patientName: patients.name, action: followUpRules.action, intervalDays: followUpRules.intervalDays, owner: tasks.owner })
    .from(findings).innerJoin(patients, eq(patients.id, findings.patientId))
    .leftJoin(followUpRules, eq(followUpRules.id, findings.ruleId)).leftJoin(tasks, eq(tasks.id, findings.taskId))
    // Riskiest first within a reading: "high" < "intermediate" < "low" also sorts alphabetically.
    .where(and(eq(findings.hospitalId, hospitalId), where)).orderBy(asc(findings.createdAt), asc(findings.riskBand), asc(findings.id));
  return rows.map(({ finding, ...rest }) => ({ ...finding, ...rest, overdue: isOverdue(finding, at), validated: false as const }));
}
export type FindingRow = Awaited<ReturnType<typeof listFindings>>[number];

export const findingsRouter = {
  /** Runs the image reader for the encounter's patient and stores one row per kind; a rerun changes nothing. */
  detect: protectedProcedure.input(z.object({ encounterId: z.string().min(1) })).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    const [visit] = await db.select().from(encounters).where(and(eq(encounters.id, input.encounterId), eq(encounters.hospitalId, hospitalId)));
    if (!visit) throw new ORPCError("NOT_FOUND", { message: `No encounter ${input.encounterId}` });
    const xray = (visit.state as { xray?: { key: string; contentType: string } }).xray;
    const object = xray && await context.uploads?.get(xray.key);
    const image = object ? { image: new Uint8Array(await object.arrayBuffer()), contentType: xray.contentType } : {};
    const read = await (context.models ?? stubModels).incidentalFindings({ patientId: visit.patientId, ...image });
    const rules = await db.select().from(followUpRules);
    const at = clockOf(context);
    const ids = read.findings.map(f => `finding:${visit.id}:${f.kind}`);
    if (!ids.length) return [];
    await db.insert(findings).values(read.findings.map((f, i) => {
      const rule = ruleFor(f, rules);
      return {
        id: ids[i]!, hospitalId, patientId: visit.patientId, encounterId: visit.id, imageKey: xray?.key, kind: f.kind, label: f.label, sizeMm: f.sizeMm,
        location: f.location, riskBand: rule?.riskBand ?? "intermediate", ruleId: rule?.id, source: read.source === "model" ? read.model : "fixture",
        dueAt: rule && dueDate(rule, at), createdAt: at,
      };
    // A repeat read may place the mark better (or add its box); status, rule and due date stay as they were.
    })).onConflictDoUpdate({ target: findings.id, set: { location: sql`excluded.location`, label: sql`excluded.label`, source: sql`excluded.source` } });
    return listFindings(db, hospitalId, at, inArray(findings.id, ids));
  }),
  /**
   * One task and one recall at the due date, then the finding is tracked. Both are keyed on the
   * finding, so a replay (any requestId) or tracking it again returns the same follow-up.
   */
  track: protectedProcedure.input(findingTrackSchema).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    const at = clockOf(context);
    const [finding] = await listFindings(db, hospitalId, at, eq(findings.id, input.findingId));
    if (!finding) throw new ORPCError("NOT_FOUND", { message: `No finding ${input.findingId}` });
    if (finding.status === "tracked") return finding;
    if (!finding.dueAt) throw new ORPCError("PRECONDITION_FAILED", { message: "No routine follow-up needed" });
    await db.insert(tasks).values({
      id: crypto.randomUUID(), hospitalId, encounterId: finding.encounterId, kind: "finding", title: findingLine({ label: finding.label, action: finding.action }),
      owner: input.owner ?? "Attending doctor", due: finding.dueAt.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" }), sourceId: finding.id, idempotencyKey: `finding:${finding.id}`,
    }).onConflictDoNothing();
    const [task] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.idempotencyKey, `finding:${finding.id}`));
    // "CT chest at 3 months, PET-CT or tissue sampling" is booked as "recall: CT chest".
    await db.insert(appointments).values({ id: `recall:${finding.id}`, patientId: finding.patientId, hospitalId, startsAt: finding.dueAt, kind: `recall: ${finding.action!.split(/,| at /)[0]}` }).onConflictDoNothing();
    await db.update(findings).set({ status: "tracked", taskId: task!.id }).where(eq(findings.id, finding.id));
    return (await listFindings(db, hospitalId, at, eq(findings.id, finding.id)))[0]!;
  }),
  /**
   * Keeps the row, marked dismissed. Who and why go in provenance (a decision on a model output),
   * since the findings table has no column for them.
   */
  dismiss: protectedProcedure.input(findingDismissSchema).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    const at = clockOf(context);
    const [finding] = await listFindings(db, hospitalId, at, eq(findings.id, input.findingId));
    if (!finding) throw new ORPCError("NOT_FOUND", { message: `No finding ${input.findingId}` });
    await db.insert(provenance).values({
      id: `dismiss:${finding.id}`, encounterId: finding.encounterId, kind: "finding-dismissed", output: { findingId: finding.id, reason: input.reason },
      sourceIds: [finding.id], model: finding.source, approvedBy: context.session.user.id, createdAt: at,
    }).onConflictDoNothing();
    await db.update(findings).set({ status: "dismissed" }).where(eq(findings.id, finding.id));
    return { ...finding, status: "dismissed" as const, overdue: false };
  }),
  /** The hospital's findings (or one encounter's), each with its rule's action and interval. */
  list: protectedProcedure.input(z.object({ encounterId: z.string().min(1).optional() })).handler(({ context, input }) =>
    listFindings(context.db, context.hospitalId, clockOf(context), input.encounterId ? eq(findings.encounterId, input.encounterId) : undefined)),
};
