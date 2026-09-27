import { appointments, encounters, findings, followUpRules } from "@sona-ai/db/schema/clinical";
import { WARNING_SIGNS, appointmentWords, followUpTiming, patientMeds } from "@sona-ai/domain/care";
import { checkInSchedule } from "@sona-ai/domain/check-ins";
import { FOLLOW_UPS, LANGUAGES, planFor, type DischargeState } from "@sona-ai/domain/discharge";
import type { Patient } from "@sona-ai/domain/types";
import { and, eq } from "drizzle-orm";

import { clockOf, type Context } from "../context";
import { patientProcedure } from "../index";

/** The patient's latest discharge, or none while they are still in hospital. */
async function lastDischarge(db: Context["db"], hospitalId: string, patientId: string) {
  const rows = await db.select({ state: encounters.state }).from(encounters).where(and(eq(encounters.patientId, patientId), eq(encounters.hospitalId, hospitalId)));
  return rows.map(r => (r.state as { discharge?: DischargeState }).discharge)
    .filter((d): d is DischargeState & { dischargedAt: string } => Boolean(d?.dischargedAt))
    .sort((a, b) => b.dischargedAt.localeCompare(a.dischargedAt))[0];
}

/** The clinic review booked at discharge, counted from the day they left. */
const reviewDate = (d: DischargeState & { dischargedAt: string }) => {
  const days = FOLLOW_UPS.find(f => f.id === d.followUp)?.days;
  return days === undefined ? undefined : new Date(new Date(d.dischargedAt).getTime() + days * 86400_000);
};

/** The patient's own plan as Sona Care shows it (and as care.ask grounds its answers), or in-hospital. */
export async function patientPlan(context: Context & { hospitalId: string; patientId: string }) {
    const d = await lastDischarge(context.db, context.hospitalId, context.patientId);
    if (!d) return { status: "in-hospital" as const };
    // ponytail: planFor ignores the patient (one authored plan for the demo).
    const plan = planFor({ id: context.patientId } as Patient);
    const date = reviewDate(d);
    return {
      status: "discharged" as const, dischargedAt: d.dischargedAt, language: d.language,
      // The language chosen at discharge first, then the others.
      leaflets: [...LANGUAGES].sort((a, b) => Number(b.id === d.language) - Number(a.id === d.language)).map(l => ({ language: l.id, label: l.label, name: l.name, text: plan.leaflet[l.id] })),
      medicines: patientMeds(plan), warningSigns: WARNING_SIGNS,
      followUp: date ? { title: "Clinic review", date } : null,
      checkIns: checkInSchedule(new Date(d.dischargedAt)).map(c => ({ day: c.day as number, date: c.dueAt })),
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

/** Sona Care's read of the patient's own plan: what they take home and what comes next. */
export const carePlanRouter = {
  discharge: patientProcedure.handler(({ context }) => patientPlan(context)),

  /**
   * What is coming up, earliest first: booked appointments (clinic visits and finding recalls), the
   * clinic review from discharge, and tracked findings whose recall is missing (a recall is keyed
   * `recall:<finding>`, so nothing shows twice). Open findings are not shown until a doctor decides.
   * ponytail: nothing records attendance, so a past recall or review reads overdue; a past clinic visit is dropped.
   */
  followUps: patientProcedure.handler(async ({ context }) => {
    const { db, hospitalId, patientId } = context, now = clockOf(context);
    const [booked, tracked, d] = await Promise.all([
      db.select().from(appointments).where(and(eq(appointments.patientId, patientId), eq(appointments.hospitalId, hospitalId))),
      db.select({ id: findings.id, kind: findings.kind, dueAt: findings.dueAt, action: followUpRules.action }).from(findings).leftJoin(followUpRules, eq(followUpRules.id, findings.ruleId)).where(and(eq(findings.patientId, patientId), eq(findings.hospitalId, hospitalId), eq(findings.status, "tracked"))),
      lastDischarge(db, hospitalId, patientId),
    ]);
    const kindOf = new Map(tracked.map(f => [`recall:${f.id}`, f.kind]));
    const review = d && reviewDate(d);
    const items = [
      ...booked.filter(a => kindOf.has(a.id) || a.startsAt >= now).map(a => ({ id: a.id, date: a.startsAt, ...appointmentWords(a.kind, kindOf.get(a.id)) })),
      ...tracked.filter(f => f.dueAt && !booked.some(a => a.id === `recall:${f.id}`)).map(f => ({ id: `recall:${f.id}`, date: f.dueAt!, ...appointmentWords(f.action ?? f.kind, f.kind) })),
      ...(review ? [{ id: "discharge-review", date: review, title: "Clinic review", short: "Clinic review", why: "To see how you're doing after your pneumonia" }] : []),
    ];
    return items.sort((a, b) => a.date.getTime() - b.date.getTime()).map(i => ({ ...i, ...followUpTiming(i.date, now) }));
  }),
};
