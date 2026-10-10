import { ORPCError } from "@orpc/server";
import { doctors, encounters, hospitals, labResults, observations, patients, visitSummaries } from "@sona-ai/db/schema/clinical";
import { warningSigns } from "@sona-ai/domain/care";
import { planFor } from "@sona-ai/domain/discharge";
import { and, asc, desc, eq, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";

import { recordAccess } from "../access";
import { clockOf, type Context } from "../context";
import { renderHealthSummary, summaryFilename, type HealthSummary } from "../health-summary-pdf";
import { patientProcedure, protectedProcedure } from "../index";
import { base64 } from "../workers-models";
import { followUpsOf, lastDischarge } from "./care-plan";
import { reading, recordOf, timelineOf } from "./encounter";

const RESULTS_MAX = 12, VISITS_MAX = 8;
type PatientContext = Context & { hospitalId: string; patientId: string };

/**
 * One patient's health summary from the rows the apps already read: the record (recordOf, planFor's diagnosis and
 * take-home list), the latest results and observations, the latest approved visit summary, the latest visit's timeline,
 * the discharge with its warning signs, the visits still to come (followUpsOf) and the hospital's care team. Only in the
 * caller's hospital: another hospital's patient is not found.
 */
export async function healthSummaryOf(context: PatientContext): Promise<HealthSummary> {
  const { db, hospitalId, patientId } = context;
  const [row] = await db.select({ patient: patients, hospital: hospitals.name }).from(patients).innerJoin(hospitals, eq(hospitals.id, patients.hospitalId))
    .where(and(eq(patients.id, patientId), eq(patients.hospitalId, hospitalId)));
  if (!row) throw new ORPCError("NOT_FOUND", { message: `No patient ${patientId}` });
  const record = recordOf(row.patient), plan = planFor(record);
  const [labs, chart, [summary], [visit], discharge, visitsAhead, team] = await Promise.all([
    db.select().from(labResults).where(and(eq(labResults.patientId, patientId), or(isNull(labResults.flag), ne(labResults.flag, "pending")))).orderBy(desc(labResults.receivedAt)).limit(RESULTS_MAX),
    db.select().from(observations).where(eq(observations.patientId, patientId)).orderBy(asc(observations.observedAt)),
    db.select().from(visitSummaries).where(and(eq(visitSummaries.patientId, patientId), eq(visitSummaries.hospitalId, hospitalId), eq(visitSummaries.status, "approved")))
      .orderBy(desc(visitSummaries.approvedAt)).limit(1),
    db.select({ id: encounters.id }).from(encounters).where(and(eq(encounters.patientId, patientId), eq(encounters.hospitalId, hospitalId))).limit(1),
    lastDischarge(db, hospitalId, patientId),
    followUpsOf(context),
    db.select().from(doctors).where(and(eq(doctors.hospitalId, hospitalId), eq(doctors.careTeam, true))).orderBy(asc(doctors.name)),
  ]);
  const events = visit ? await timelineOf(db, hospitalId, discharge?.encounterId ?? visit.id) : [];
  // The last reading of each kind (rows come oldest first); a record with no chart rows keeps the vitals written at intake.
  const latest = [...new Map(chart.map(o => [o.kind, o])).values()];
  // The take-home list once one is written, otherwise the medicines on record ("Metformin 500 mg twice daily": the name, then the dose).
  const medicines = record.takeHome?.length ? record.takeHome : record.medicines.map(m => {
    const at = m.search(/\s\d/);
    return { name: at < 0 ? m : m.slice(0, at), detail: at < 0 ? "" : m.slice(at + 1), change: "unchanged" as const };
  });
  return {
    hospital: row.hospital, generatedAt: clockOf(context),
    patient: { id: record.id, name: record.name, age: record.age, sex: record.sex },
    allergies: record.allergies, problems: plan.summary.diagnosis, complaint: record.complaint, history: record.history,
    family: record.family || undefined, social: record.social || undefined, medicines,
    results: labs.map(l => ({ test: l.test, value: l.value, unit: l.unit, flag: l.flag, at: l.receivedAt })),
    observations: latest.length ? latest.map(o => ({ label: reading(o), at: o.observedAt })) : (record.vitals ?? []).map(v => ({ label: `${v.label} ${v.value}` })),
    visitSummary: summary && { at: summary.createdAt, text: summary.approvedText ?? summary.text, whatChanged: summary.whatChanged },
    visits: events.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, VISITS_MAX).map(({ at, title, detail }) => ({ at, title, detail })),
    discharge: discharge && { at: new Date(discharge.dischargedAt), warningSigns: warningSigns(plan) },
    followUps: visitsAhead.filter(v => v.inDays >= 0).map(v => ({ title: v.title, date: v.date })),
    careTeam: team.map(d => ({ name: d.name, specialty: d.specialty, room: d.room })),
  };
}

/** The PDF as base64 with its file name, for the web to download and the apps to write to a file and share. */
async function exported(context: PatientContext) {
  const summary = await healthSummaryOf(context);
  return { filename: summaryFilename(summary), pdf: base64(await renderHealthSummary(summary)) };
}

/**
 * The summary itself, for the Health summary pages: the same object the PDF renders, so the page and the file cannot
 * differ. A clinician's view is in the access trail like every other read of the record ("viewed the health summary");
 * the patient reading her own is not, as no Sona Care read is.
 */
export const proHealthSummaryData = protectedProcedure.input(z.object({ patientId: z.string().min(1) })).handler(({ context, input }) => healthSummaryOf({ ...context, patientId: input.patientId }));
export const careHealthSummaryData = patientProcedure.handler(({ context }) => healthSummaryOf(context));

/**
 * Clinician (Sona Pro): a patient's summary to send to another hospital on transfer. The access trail logs it as any
 * call naming a patient is (patients.summary, "exported a health summary").
 */
export const proHealthSummary = protectedProcedure.input(z.object({ patientId: z.string().min(1) })).handler(({ context, input }) => exported({ ...context, patientId: input.patientId }));

/**
 * Patient (Sona Care): their own summary, to take to another hospital. Sona Care's routes are otherwise not in the
 * access trail; this one is, since the whole record leaves the hospital, under the patient's own account.
 */
export const careHealthSummary = patientProcedure.handler(async ({ context }) => {
  const out = await exported(context);
  await recordAccess(context, context.hospitalId, context.session.user.id, "care.healthSummary", { patientId: context.patientId })
    .catch(error => console.error("access log failed", error));
  return out;
});
