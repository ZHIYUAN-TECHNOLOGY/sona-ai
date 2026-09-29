import { accessLogs, appointments, encounters, findings, followUpRules, hospitalMembers, patients } from "@sona-ai/db/schema/clinical";
import { appointmentWords, followUpTiming, malaysianDay, patientMeds, reviewWords, warningSigns } from "@sona-ai/domain/care";
import { checkInSchedule } from "@sona-ai/domain/check-ins";
import { FOLLOW_UPS, LANGUAGES, planFor, type DischargeState, type Language } from "@sona-ai/domain/discharge";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { clockOf, type Context } from "../context";
import { patientProcedure } from "../index";
import { recordOf } from "./encounter";

/** The patient's own discharge plan, built from their record in this hospital. */
export async function planOf(db: Context["db"], hospitalId: string, patientId: string) {
  const [row] = await db.select().from(patients).where(and(eq(patients.id, patientId), eq(patients.hospitalId, hospitalId)));
  return planFor(row ? recordOf(row) : { id: patientId });
}

/** The patient's latest discharge, or none while they are still in hospital. */
export async function lastDischarge(db: Context["db"], hospitalId: string, patientId: string) {
  const rows = await db.select({ state: encounters.state }).from(encounters).where(and(eq(encounters.patientId, patientId), eq(encounters.hospitalId, hospitalId)));
  return rows.map(r => (r.state as { discharge?: DischargeState }).discharge)
    .filter((d): d is DischargeState & { dischargedAt: string } => Boolean(d?.dischargedAt))
    .sort((a, b) => b.dischargedAt.localeCompare(a.dischargedAt))[0];
}

/**
 * The patient's take-home dose schedule (new, changed and continuing medicines with their times) and
 * when they left, or undefined while in hospital. Sona Care builds the same list from care.discharge.
 */
export async function doseScheduleOf(db: Context["db"], hospitalId: string, patientId: string) {
  const d = await lastDischarge(db, hospitalId, patientId);
  if (!d) return undefined;
  const m = patientMeds(await planOf(db, hospitalId, patientId));
  return { dischargedAt: d.dischargedAt, meds: [...m.new, ...m.changed, ...m.continue] };
}

/** The clinic review booked at discharge, counted from the day they left. */
const reviewDate = (d: DischargeState & { dischargedAt: string }) => {
  const days = FOLLOW_UPS.find(f => f.id === d.followUp)?.days;
  return days === undefined ? undefined : new Date(new Date(d.dischargedAt).getTime() + days * 86400_000);
};

/** The patient's own plan as Sona Care shows it (and as care.ask grounds its answers), or in-hospital; patient-facing words in `lang`. */
export async function patientPlan(context: Context & { hospitalId: string; patientId: string }, lang: Language = "en") {
    const d = await lastDischarge(context.db, context.hospitalId, context.patientId);
    if (!d) return { status: "in-hospital" as const };
    const plan = await planOf(context.db, context.hospitalId, context.patientId);
    const date = reviewDate(d);
    return {
      status: "discharged" as const, dischargedAt: d.dischargedAt, language: d.language,
      // The language chosen at discharge first, then the others.
      leaflets: [...LANGUAGES].sort((a, b) => Number(b.id === d.language) - Number(a.id === d.language)).map(l => ({ language: l.id, label: l.label, name: l.name, text: plan.leaflet[l.id] })),
      medicines: patientMeds(plan, lang), warningSigns: warningSigns(plan, lang),
      followUp: date ? { title: reviewWords(plan, lang).title, date } : null,
      checkIns: checkInSchedule(new Date(d.dischargedAt), d.checkInDays).map(c => ({ day: c.day, date: c.dueAt })),
    };
}

/** The plan as plain text for the model: only what the patient's own app already shows them. */
export function planText(plan: Extract<Awaited<ReturnType<typeof patientPlan>>, { status: "discharged" }>) {
  const meds = Object.entries(plan.medicines).flatMap(([group, list]) => list.map(m => `- ${m.name} (${group}): ${m.line}${m.take ? `; ${m.take}` : ""}`));
  const leaflet = plan.leaflets.find(l => l.language === plan.language) ?? plan.leaflets[0];
  return [
    `Discharged: ${plan.dischargedAt}`,
    "Medicines:", ...meds,
    "Come back or call if:", ...plan.warningSigns.map(w => `- ${w}`),
    plan.followUp ? `Follow-up: ${plan.followUp.title} on ${new Date(plan.followUp.date).toDateString()}` : "Follow-up: none booked",
    `Check-ins: day ${plan.checkIns.map(c => c.day).join(" and ")} after discharge`,
    `Leaflet (${leaflet?.label ?? ""}):`, leaflet?.text ?? "",
  ].join("\n");
}

/**
 * The days (Malaysian calendar) a doctor opened or saved this patient's visit or note: a follow-up on
 * one of those days was attended. Read from the PDPA access trail, stamped with the demo clock.
 * ponytail: any doctor's look that day counts for every follow-up that day; a check-in step replaces it.
 */
const SEEN_ROUTES = ["encounter.get", "encounter.edit", "note.get", "note.save"];
async function seenDays(db: Context["db"], hospitalId: string, patientId: string) {
  const rows = await db.select({ at: accessLogs.at }).from(accessLogs).innerJoin(hospitalMembers, eq(hospitalMembers.userId, accessLogs.userId))
    .where(and(eq(accessLogs.hospitalId, hospitalId), eq(accessLogs.patientId, patientId), inArray(accessLogs.route, SEEN_ROUTES), eq(hospitalMembers.role, "doctor")));
  return new Set(rows.map(r => malaysianDay(r.at)));
}

/** Sona Care asks for its words in the patient's language; English when it does not say. */
const langInput = z.object({ lang: z.enum(["en", "ms", "zh"]).optional() }).optional();

/** Sona Care's read of the patient's own plan: what they take home and what comes next. */
export const carePlanRouter = {
  discharge: patientProcedure.input(langInput).handler(({ context, input }) => patientPlan(context, input?.lang)),

  /**
   * What is coming up, earliest first: booked appointments (clinic visits and finding recalls), the
   * clinic review from discharge, and tracked findings whose recall is missing (a recall is keyed
   * `recall:<finding>`, so nothing shows twice). Open findings are not shown until a doctor decides.
   * A visit stays due soon all through its own day; after it, attended if a doctor saw the patient that
   * day (seenDays), else missed (the app offers to call the clinic). Words in `lang`, English when absent.
   */
  followUps: patientProcedure.input(langInput).handler(async ({ context, input }) => {
    const { db, hospitalId, patientId } = context, now = clockOf(context), lang = input?.lang;
    const [booked, tracked, d, seen] = await Promise.all([
      db.select().from(appointments).where(and(eq(appointments.patientId, patientId), eq(appointments.hospitalId, hospitalId))),
      db.select({ id: findings.id, kind: findings.kind, dueAt: findings.dueAt, action: followUpRules.action }).from(findings).leftJoin(followUpRules, eq(followUpRules.id, findings.ruleId)).where(and(eq(findings.patientId, patientId), eq(findings.hospitalId, hospitalId), eq(findings.status, "tracked"))),
      lastDischarge(db, hospitalId, patientId),
      seenDays(db, hospitalId, patientId),
    ]);
    const kindOf = new Map(tracked.map(f => [`recall:${f.id}`, f.kind]));
    const review = d && reviewDate(d);
    const items = [
      ...booked.map(a => ({ id: a.id, date: a.startsAt, ...appointmentWords(a.kind, kindOf.get(a.id), lang) })),
      ...tracked.filter(f => f.dueAt && !booked.some(a => a.id === `recall:${f.id}`)).map(f => ({ id: `recall:${f.id}`, date: f.dueAt!, ...appointmentWords(f.action ?? f.kind, f.kind, lang) })),
      ...(review ? [{ id: "discharge-review", date: review, ...reviewWords(await planOf(db, hospitalId, patientId), lang) }] : []),
    ];
    // A past visit only counts once she has gone home and it came after; one from her stay is dropped.
    const home = d ? new Date(d.dischargedAt) : now;
    return items.map(i => ({ ...i, ...followUpTiming(i.date, now, seen.has(malaysianDay(i.date))) })).filter(i => i.inDays >= 0 || i.date >= home)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }),
};
