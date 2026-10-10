import { accessLogs, appointments, bookingRequests, checkIns, doctors, doseLogs, encounters, findings, followUpRules, hospitalMembers, notes, patients, receipts } from "@sona-ai/db/schema/clinical";
import { appointmentWords, followUpTiming, malaysianDay, patientMeds, reviewWords, warningSigns } from "@sona-ai/domain/care";
import { checkInDaysLine, checkInSchedule } from "@sona-ai/domain/check-ins";
import { FOLLOW_UPS, LANGUAGES, planFor, type DischargeState, type Language } from "@sona-ai/domain/discharge";
import { adherence } from "@sona-ai/domain/doses";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";

import { originOf } from "../answers";
import { clockOf, type Context } from "../context";
import { patientProcedure } from "../index";
import type { ApprovedLeaflet } from "./discharge";
import { listCheckIns } from "./check-ins";
import { malaysiaDay, recordFacts, recordOf } from "./encounter";

/** The patient's own discharge plan, built from their record in this hospital. */
export async function planOf(db: Context["db"], hospitalId: string, patientId: string) {
  const [row] = await db.select().from(patients).where(and(eq(patients.id, patientId), eq(patients.hospitalId, hospitalId)));
  return planFor(row ? recordOf(row) : { id: patientId });
}

/** The patient's latest discharge (with its visit), or none while they are still in hospital. */
export async function lastDischarge(db: Context["db"], hospitalId: string, patientId: string) {
  const rows = await db.select({ id: encounters.id, state: encounters.state }).from(encounters).where(and(eq(encounters.patientId, patientId), eq(encounters.hospitalId, hospitalId)));
  return rows.map(r => ({ ...(r.state as { discharge?: DischargeState & { leaflet?: ApprovedLeaflet } }).discharge, encounterId: r.id }))
    .filter((d): d is DischargeState & { dischargedAt: string; leaflet?: ApprovedLeaflet; encounterId: string } => Boolean(d.dischargedAt))
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

/** The dose keys this patient marked taken (hold to take in Sona Care). */
export const takenKeys = async (db: Context["db"], hospitalId: string, patientId: string) =>
  (await db.select({ key: doseLogs.key }).from(doseLogs).where(and(eq(doseLogs.hospitalId, hospitalId), eq(doseLogs.patientId, patientId)))).map(r => r.key);

/** The clinic review booked at discharge, counted from the day they left. */
const reviewDate = (d: DischargeState & { dischargedAt: string }) => {
  const days = FOLLOW_UPS.find(f => f.id === d.followUp)?.days;
  return days === undefined ? undefined : new Date(new Date(d.dischargedAt).getTime() + days * 86400_000);
};

type PatientContext = Context & { hospitalId: string; patientId: string };

/**
 * The patient's own plan as Sona Care shows it (and as care.ask grounds its answers), or in-hospital; patient-facing words in `lang`.
 * Courses are read on the demo clock, so a finished one says so. The check-ins are the visit's own rows (the check-in
 * agent can bring one forward); a discharge from before they were stored keeps the days chosen then.
 */
export async function patientPlan(context: PatientContext, lang: Language = "en") {
    const d = await lastDischarge(context.db, context.hospitalId, context.patientId);
    if (!d) return { status: "in-hospital" as const };
    const [plan, scheduled] = await Promise.all([
      planOf(context.db, context.hospitalId, context.patientId),
      context.db.select({ day: checkIns.day, date: checkIns.dueAt }).from(checkIns)
        .where(and(eq(checkIns.hospitalId, context.hospitalId), eq(checkIns.encounterId, d.encounterId))).orderBy(asc(checkIns.dueAt)),
    ]);
    const date = reviewDate(d);
    return {
      status: "discharged" as const, dischargedAt: d.dischargedAt, language: d.language,
      // The language chosen at discharge first, then the others; the leaflet approved at discharge in its own
      // language (older discharges kept none), the authored one in the rest. Each says which it is: a model's draft
      // with the doctor who approved it ("unknown" when the discharge kept only the words), or "fixture" for the authored one.
      leaflets: [...LANGUAGES].sort((a, b) => Number(b.id === d.language) - Number(a.id === d.language))
        .map(l => ({ language: l.id, label: l.label, name: l.name, ...d.leaflet?.language === l.id
          ? { text: d.leaflet.text, ...originOf(d.leaflet.model), approvedBy: d.leaflet.approvedBy, approvedAt: d.leaflet.approvedAt }
          : { text: plan.leaflet[l.id], source: "fixture" as const } })),
      medicines: patientMeds(plan, lang, { out: d.dischargedAt, now: clockOf(context) }), warningSigns: warningSigns(plan, lang),
      followUp: date ? { title: reviewWords(plan, lang).title, date } : null,
      checkIns: scheduled.length ? scheduled : checkInSchedule(new Date(d.dischargedAt), d.checkInDays).map(c => ({ day: c.day, date: c.dueAt })),
    };
}

/** The plan as plain text for the model: only what the patient's own app already shows them. A course gives its last dose. */
export function planText(plan: Extract<Awaited<ReturnType<typeof patientPlan>>, { status: "discharged" }>) {
  const meds = Object.entries(plan.medicines).flatMap(([group, list]) => list.map(m =>
    `- ${m.name} (${group}): ${[m.line, !m.finished && m.take, m.endsAt && `last dose ${malaysiaDay(m.endsAt)}`].filter(Boolean).join("; ")}`));
  return [
    `Discharged: ${plan.dischargedAt}`,
    "Medicines:", ...meds,
    "Come back or call if:", ...plan.warningSigns.map(w => `- ${w}`),
    plan.followUp ? `Follow-up: ${plan.followUp.title} on ${new Date(plan.followUp.date).toDateString()}` : "Follow-up: none booked",
    `Check-ins: ${checkInDaysLine(plan.checkIns.map(c => c.day))} after discharge`,
  ].join("\n");
}

/** Her discharge leaflet: general advice, the longest part of her record, so recordText puts it last. */
export function leafletText(plan: Extract<Awaited<ReturnType<typeof patientPlan>>, { status: "discharged" }>) {
  const leaflet = plan.leaflets.find(l => l.language === plan.language) ?? plan.leaflets[0];
  return leaflet ? `Leaflet (${leaflet.label}):\n${leaflet.text}` : "";
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

/**
 * What is coming up, earliest first: booked appointments (clinic visits and finding recalls), the
 * clinic review from discharge, and tracked findings whose recall is missing (a recall is keyed
 * `recall:<finding>`, so nothing shows twice). Open findings are not shown until a doctor decides.
 * A visit stays due soon all through its own day; after it, attended if a doctor saw the patient that
 * day (seenDays), else missed (the app offers to call the clinic). Words in `lang`, English when absent.
 */
export async function followUpsOf(context: PatientContext, lang?: Language) {
  const { db, hospitalId, patientId } = context, now = clockOf(context);
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
}

/** "Thu, 01 Oct 2026 10:30": the time in Malaysia. */
const malaysiaTime = (at: Date) => new Date(at.getTime() + 8 * 3600_000).toUTCString().slice(0, 22);

/**
 * Her visits as plain text for the model, in hospital or home: the ones her Home and Schedule show (followUpsOf) and
 * the times she asked for that the care team has yet to confirm. With the time now, so "next" is never one already
 * gone by. A booked visit has a time; a recall or the discharge review only its day.
 */
export async function visitsText(context: PatientContext) {
  const { db, hospitalId, patientId } = context, now = clockOf(context);
  const [visits, asked] = await Promise.all([
    followUpsOf(context),
    db.select({ doctor: doctors.name, specialty: doctors.specialty, at: bookingRequests.startsAt }).from(bookingRequests).innerJoin(doctors, eq(doctors.id, bookingRequests.doctorId))
      .where(and(eq(bookingRequests.hospitalId, hospitalId), eq(bookingRequests.patientId, patientId), eq(bookingRequests.status, "requested"), gte(bookingRequests.startsAt, now)))
      .orderBy(asc(bookingRequests.startsAt)),
  ]);
  const line = (v: (typeof visits)[number]) => {
    const dayOnly = v.id.startsWith("recall:") || v.id === "discharge-review";
    return `- ${v.title}: ${dayOnly ? malaysiaDay(v.date) : malaysiaTime(v.date)} (${v.status === "attended" || v.status === "missed" ? v.status : !dayOnly && v.date < now ? "earlier today" : "coming up"})`;
  };
  return [
    `Now: ${malaysiaTime(now)} (Malaysia time)`,
    "Visits booked:", ...(visits.length ? visits.map(line) : ["- none"]),
    "Visits requested, waiting for the care team to confirm:", ...(asked.length ? asked.map(r => `- ${r.doctor} (${r.specialty}): ${malaysiaTime(r.at)}`) : ["- none"]),
  ].join("\n");
}

/**
 * The size of the record a Sona Care answer reads, typed or spoken: 6,000 characters, about 2,000 of Gemma's 16,384
 * tokens at 3 characters a token (baseten-models), so a call's conversation and the answer keep the rest, and a spoken
 * turn waits on a short prompt. Inside it the doctor's note gets NOTE_CHARS and the check-ins their last REPLIES_MAX replies.
 */
export const RECORD_CHARS = 6000;
const NOTE_CHARS = 1200, REPLIES_MAX = 5, REPLY_CHARS = 200, MISSED_MAX = 5;

/**
 * Her own record as plain text for the model, the same for a typed question (care.ask) and a call (the voice agents):
 * her plan once home (planText), her visits (visitsText), then what the hospital recorded about her (recordFacts: history,
 * allergy, medicines, observations, results), her latest saved note, her check-in replies as they were read, and the doses
 * she marked taken or not. Every row is hers alone: each read is keyed by the signed-in patient and her hospital.
 * Only the plan must be read (as before); a part that cannot be read is left out, never failing the answer, so the urgent
 * gates after it still run.
 */
/**
 * The prescriptions her doctor approved on her visits (Sona Pro's prescribing), the newest of each medicine, as lines
 * with their dose, route, how often and for how long: what the ward gives her, which no other part of the record holds.
 */
async function prescribed(db: PatientContext["db"], hospitalId: string, patientId: string) {
  const rows = await db.select({ payload: receipts.payload, at: receipts.createdAt }).from(receipts).innerJoin(encounters, eq(encounters.id, receipts.encounterId))
    .where(and(eq(receipts.kind, "prescription"), eq(encounters.patientId, patientId), eq(encounters.hospitalId, hospitalId))).orderBy(desc(receipts.createdAt));
  type Ordered = { medication?: string; formulation?: string; dose?: string; unit?: string; route?: string; frequency?: string; duration?: string };
  const newest = new Map<string, { r: Ordered; at: Date }>();
  for (const { payload, at } of rows) { const r = payload as Ordered; if (r.medication && !newest.has(r.medication.toLowerCase())) newest.set(r.medication.toLowerCase(), { r, at }); }
  return [...newest.values()].map(({ r, at }) => `- ${[r.medication, r.formulation, r.dose && `${r.dose} ${r.unit ?? ""}`.trim(), r.route, r.frequency, r.duration && `for ${r.duration}`].filter(Boolean).join(", ")} (approved ${malaysiaDay(at)})`);
}

export async function recordText(context: PatientContext) {
  const { db, hospitalId, patientId } = context, now = clockOf(context);
  const unread = <T>(what: string, none: T) => (error: unknown) => { console.error(`${what} not read`, error); return none; };
  const [plan, visits, facts, [note], asked, taken, ordered] = await Promise.all([
    patientPlan(context),
    visitsText(context).catch(unread("visits", "")),
    recordFacts(db, hospitalId, patientId, { forPatient: true }).catch(unread("record", [] as string[])),
    db.select({ sentences: notes.sentences, at: notes.createdAt }).from(notes).innerJoin(encounters, eq(encounters.id, notes.encounterId))
      .where(and(eq(encounters.patientId, patientId), eq(encounters.hospitalId, hospitalId))).orderBy(desc(notes.createdAt), desc(notes.revision)).limit(1)
      .catch(unread("note", [] as { sentences: { id: string; text: string }[]; at: Date }[])),
    listCheckIns(db, hospitalId, { patientId }).catch(unread("check-ins", [] as Awaited<ReturnType<typeof listCheckIns>>)),
    takenKeys(db, hospitalId, patientId).catch(unread("doses", [] as string[])),
    prescribed(db, hospitalId, patientId).catch(unread("prescriptions", [] as string[])),
  ]);
  const replies = asked.flatMap(c => c.replies.map(r => `- Day ${c.day} check-in, ${malaysiaDay(r.receivedAt)}: "${r.text.slice(0, REPLY_CHARS)}" (read as ${r.label})`)).slice(-REPLIES_MAX);
  // The note's sentences in order, whole, while they fit.
  const noted = (note?.sentences ?? []).map(s => s.text).filter((_, i, all) => all.slice(0, i + 1).join(" ").length <= NOTE_CHARS).join(" ");
  // Doses count from the plan's own schedule, as the care team's adherence line does (doses.ts).
  const doses = plan.status === "discharged" ? adherence([...plan.medicines.new, ...plan.medicines.changed, ...plan.medicines.continue], plan.dischargedAt, taken, now) : undefined;
  // Her medicines, doses and check-ins first and the general leaflet last, so a record past RECORD_CHARS loses the leaflet,
  // then the note, first. ponytail: her rows are read whole and cut from the end; a long record would need retrieval by the question.
  const text = [
    plan.status === "discharged" ? planText(plan) : "Still in hospital: no take-home medicines or leaflet yet.",
    ...(ordered.length ? ["Prescribed by her doctor in hospital:", ...ordered] : []),
    ...(doses?.due ? [`Doses since going home: ${doses.taken} of ${doses.due} due marked taken${doses.missed.length ? `; not marked taken: ${doses.missed.slice(-MISSED_MAX).map(m => `${m.name} ${malaysiaTime(m.dueAt)}`).join(", ")}` : ""}`] : []),
    ...(replies.length ? ["Check-in replies:", ...replies] : []),
    visits,
    ...(facts.length ? ["Recorded by the hospital:", ...facts] : []),
    ...(noted ? [`Doctor's note (saved ${malaysiaDay(note!.at)}):`, noted] : []),
    plan.status === "discharged" ? leafletText(plan) : "",
  ].filter(Boolean).join("\n");
  return { plan, text: text.length > RECORD_CHARS ? text.slice(0, text.lastIndexOf("\n", RECORD_CHARS)) : text };
}

/** Sona Care's read of the patient's own plan: what they take home and what comes next. */
export const carePlanRouter = {
  discharge: patientProcedure.input(langInput).handler(({ context, input }) => patientPlan(context, input?.lang)),
  /** Her visits, earliest first (followUpsOf). */
  followUps: patientProcedure.input(langInput).handler(({ context, input }) => followUpsOf(context, input?.lang)),
};
