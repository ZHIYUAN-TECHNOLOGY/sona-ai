import { ORPCError } from "@orpc/server";
import { appointments, encounters, findings, followUpRules, patients, provenance, tasks } from "@sona-ai/db/schema/clinical";
import { dueDate, findingLine, isOverdue, ruleFor } from "@sona-ai/domain/findings";
import { and, asc, eq, ne, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { answerOnce } from "../answers";
import { findingDismissSchema, findingTrackSchema } from "../contracts";
import { clockOf, type Context } from "../context";
import { stubModels } from "../models";
import { protectedProcedure } from "../index";
import { tellPatient } from "../push";

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

/** "CT chest at 3 months, PET-CT or tissue sampling" → "CT chest": what gets booked. */
export const testOf = (action: string | null | undefined) => action?.split(/,| at /)[0]?.trim() || "follow-up test";

/**
 * One task and one recall (at `recallAt`, else the rule's due date), then the finding is tracked. Both
 * are keyed on the finding, so tracking it again returns the same follow-up.
 */
export async function trackFinding(context: Context, hospitalId: string, findingId: string, owner?: string, recallAt?: Date) {
  const { db } = context;
  const at = clockOf(context);
  const [finding] = await listFindings(db, hospitalId, at, eq(findings.id, findingId));
  if (!finding) throw new ORPCError("NOT_FOUND", { message: `No finding ${findingId}` });
  if (finding.status === "tracked") return finding;
  if (!finding.dueAt) throw new ORPCError("PRECONDITION_FAILED", { message: "No routine follow-up needed" });
  const due = recallAt ?? finding.dueAt;
  await db.insert(tasks).values({
    id: crypto.randomUUID(), hospitalId, encounterId: finding.encounterId, kind: "finding", title: findingLine({ label: finding.label, action: finding.action }),
    owner: owner ?? "Attending doctor", due: due.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" }), sourceId: finding.id, idempotencyKey: `finding:${finding.id}`,
  }).onConflictDoNothing();
  const [task] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.idempotencyKey, `finding:${finding.id}`));
  // "CT chest at 3 months, PET-CT or tissue sampling" is booked as "recall: CT chest".
  await db.insert(appointments).values({ id: `recall:${finding.id}`, patientId: finding.patientId, hospitalId, startsAt: due, kind: `recall: ${testOf(finding.action)}` }).onConflictDoNothing();
  await db.update(findings).set({ status: "tracked", taskId: task!.id }).where(eq(findings.id, finding.id));
  return (await listFindings(db, hospitalId, at, eq(findings.id, finding.id)))[0]!;
}

/** A patient's findings that still need a routine follow-up and are not yet on the visit at `visitAt`: what "Book in" offers to add. */
export async function followUpsToAdd(context: Context, hospitalId: string, patientId: string, visitAt: Date) {
  const rows = await listFindings(context.db, hospitalId, clockOf(context), and(eq(findings.patientId, patientId), ne(findings.status, "dismissed")));
  const recalls = await context.db.select({ id: appointments.id, startsAt: appointments.startsAt }).from(appointments).where(and(eq(appointments.patientId, patientId), eq(appointments.hospitalId, hospitalId)));
  const sameTrip = new Set(recalls.filter(r => r.startsAt.getTime() === visitAt.getTime()).map(r => r.id));
  return rows.filter(f => f.dueAt && !sameTrip.has(`recall:${f.id}`)).map(f => ({ id: f.id, label: f.label, test: testOf(f.action), tracked: f.status === "tracked", dueAt: f.dueAt! }));
}

export const findingsRouter = {
  /**
   * Runs the image reader for the encounter's patient and stores one row per kind; a rerun changes nothing. A model
   * reads each image once: detecting again on the same image reuses its stored reading.
   */
  detect: protectedProcedure.input(z.object({ encounterId: z.string().min(1) })).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    const [visit] = await db.select().from(encounters).where(and(eq(encounters.id, input.encounterId), eq(encounters.hospitalId, hospitalId)));
    if (!visit) throw new ORPCError("NOT_FOUND", { message: `No encounter ${input.encounterId}` });
    const xray = (visit.state as { xray?: { key: string; contentType: string } }).xray;
    const read = await answerOnce(db, visit.id, "incidental-findings", { image: xray?.key }, async () => {
      const object = xray && await context.uploads?.get(xray.key);
      const image = object ? { image: new Uint8Array(await object.arrayBuffer()), contentType: xray.contentType } : {};
      return (context.models ?? stubModels).incidentalFindings({ patientId: visit.patientId, ...image });
    }, () => (xray ? [xray.key] : []));
    const rules = await db.select().from(followUpRules);
    const at = clockOf(context);
    const ids = read.findings.map(f => `finding:${visit.id}:${f.kind}`);
    if (!ids.length) return [];
    // A mark belongs to the image it was read from: the authored fixture was read from no upload, so it carries no key
    // (the app shows it on the bundled reference film only), and a model's carries the key of the image it read.
    const imageKey = read.source === "model" ? xray?.key ?? null : null;
    await db.insert(findings).values(read.findings.map((f, i) => {
      const rule = ruleFor(f, rules);
      return {
        id: ids[i]!, hospitalId, patientId: visit.patientId, encounterId: visit.id, imageKey, kind: f.kind, label: f.label, sizeMm: f.sizeMm,
        location: f.location, riskBand: rule?.riskBand ?? "intermediate", ruleId: rule?.id, source: read.source === "model" ? read.model : "fixture",
        dueAt: rule && dueDate(rule, at), createdAt: at,
      };
    // A repeat read may place the mark better (or add its box), on whichever image it read; status, rule and due date stay as they were.
    })).onConflictDoUpdate({ target: findings.id, set: { location: sql`excluded.location`, label: sql`excluded.label`, source: sql`excluded.source`, imageKey: sql`excluded.image_key` } });
    return listFindings(db, hospitalId, at, inArray(findings.id, ids));
  }),
  /**
   * One task and one recall at the due date, then the finding is tracked. Both are keyed on the
   * finding, so a replay (any requestId) or tracking it again returns the same follow-up.
   */
  track: protectedProcedure.input(findingTrackSchema).handler(async ({ context, input }) => {
    const finding = await trackFinding(context, context.hospitalId, input.findingId, input.owner);
    // The middleware announces this write without a patient; Sona Care hears of the new recall here.
    await context.announce?.(context.hospitalId, { topic: "findings", patientId: finding.patientId }).catch(() => {});
    return finding;
  }),
  /**
   * Same trip: moves a finding's follow-up onto a visit the patient already has (the "Book in" from a
   * flagged check-in), tracking it first if it was open. Her Sona Care then shows the test on that
   * visit. Only her own visit at this hospital; a replay changes nothing.
   */
  addToVisit: protectedProcedure.input(z.object({ findingId: z.string().min(1), appointmentId: z.string().min(1) })).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    const [visit] = await db.select().from(appointments).where(and(eq(appointments.id, input.appointmentId), eq(appointments.hospitalId, hospitalId)));
    const [found] = await listFindings(db, hospitalId, clockOf(context), eq(findings.id, input.findingId));
    if (!visit || !found || found.patientId !== visit.patientId) throw new ORPCError("NOT_FOUND", { message: "That visit or finding is not this patient's" });
    const finding = await trackFinding(context, hospitalId, found.id, undefined, visit.startsAt);
    await db.update(appointments).set({ startsAt: visit.startsAt }).where(eq(appointments.id, `recall:${finding.id}`));
    // The follow-up is now due at that visit, so the ward's list and My Day show the same date.
    await db.update(findings).set({ dueAt: visit.startsAt }).where(eq(findings.id, finding.id));
    if (finding.taskId) await db.update(tasks).set({ due: visit.startsAt.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" }) }).where(eq(tasks.id, finding.taskId));
    await context.announce?.(hospitalId, { topic: "findings", patientId: visit.patientId }).catch(() => {});
    await tellPatient(context, hospitalId, visit.patientId, { kind: "added", test: testOf(finding.action), at: visit.startsAt });
    return { findingId: finding.id, recallId: `recall:${finding.id}`, startsAt: visit.startsAt, test: testOf(finding.action) };
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
