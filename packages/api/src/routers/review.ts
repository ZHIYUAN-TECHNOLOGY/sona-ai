import { ORPCError } from "@orpc/server";
import { appointments, encounters, patients, visitSummaries, type SummaryCheck, type SummarySource } from "@sona-ai/db/schema/clinical";
import { and, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";

import { clockOf, type Context } from "../context";
import { patientProcedure, protectedProcedure } from "../index";
import { stubModels, type VisitSummaryInput } from "../models";
import { loadEncounter } from "./encounter";

/** A patient reads this on a phone: about a minute of reading. */
export const SUMMARY_MAX_CHARS = 1200;
const numbersIn = (text: string) => text.match(/\d+(?:\.\d+)?/g) ?? [];
const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
const wordsOf = (text: string) => text.toLowerCase().match(/[a-z]{4,}/g) ?? [];

/** Every source of a summary, numbered: the note's sentences, then the visit's prescriptions, then its follow-ups. */
export const sourcesOf = ({ sections, prescriptions, followUps }: VisitSummaryInput): SummarySource[] => [
  ...sections.map(s => ({ kind: "note" as const, ref: s.id, text: s.text })),
  ...prescriptions.map(p => ({ kind: "prescription" as const, ref: p.name, text: [p.name, p.detail].filter(Boolean).join(" ") })),
  ...followUps.map(f => ({ kind: "follow-up" as const, ref: f, text: f })),
].map((s, i) => ({ n: i + 1, ...s }));

/** The automatic checks on a summary before a clinician reads it; pure, so approve re-runs them on an edited text. */
export function checkSummary(text: string, input: VisitSummaryInput): SummaryCheck[] {
  const sources = sourcesOf(input), facts = sources.map(s => s.text).join("\n"), known = new Set(numbersIn(facts));
  const prescribed = input.prescriptions.map(p => p.name.toLowerCase());
  // ponytail: a medicine is a word right before a dose ("amoxicillin 500 mg"); a drug dictionary lookup if names without doses matter.
  const named = [...text.matchAll(/\b([A-Za-z][A-Za-z-]{3,})\s+\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml|units?)\b/gi)].map(m => m[1]!.toLowerCase());
  const strangers = [...new Set(named.filter(n => !prescribed.some(p => p.includes(n))))];
  const unknown = [...new Set(numbersIn(text).filter(n => !known.has(n)))];
  // ponytail: sourced means half a sentence's longer words appear in one source; cite-by-number from the model if this proves loose.
  const unsourced = sentencesOf(text).filter(sentence => {
    const words = wordsOf(sentence);
    return !sources.some(s => { const has = new Set(wordsOf(s.text)); return words.length > 0 && words.filter(w => has.has(w)).length * 2 >= words.length; });
  });
  const check = (id: string, label: string, bad: string[]): SummaryCheck => ({ id, label, ok: !bad.length, ...bad.length && { detail: bad.join("; ") } });
  return [
    check("medicines", "Every medicine named is in this visit's prescriptions", strangers),
    check("doses", "Every number appears in the note or prescriptions", unknown),
    check("sources", "Every sentence has a source", unsourced),
    check("length", `Short enough to read (under ${SUMMARY_MAX_CHARS} characters)`, text.length > SUMMARY_MAX_CHARS ? [`${text.length} characters`] : []),
  ];
}

/** What the summary is drafted from: the note, the visit's medicine list (encounter state) and the patient's coming appointments. */
async function visitInput(context: Pick<Context, "db" | "now">, hospitalId: string, encounterId: string, sections: { id: string; text: string }[]) {
  const { state } = await loadEncounter(context.db, hospitalId, encounterId);
  const [{ patientId }] = await context.db.select({ patientId: encounters.patientId }).from(encounters).where(eq(encounters.id, encounterId)) as [{ patientId: string }];
  const meds = (state as { medicationEntries?: { name: string; formulation?: string; change?: "new" | "changed" | "stopped"; from?: string }[] }).medicationEntries ?? [];
  const coming = await context.db.select().from(appointments)
    .where(and(eq(appointments.hospitalId, hospitalId), eq(appointments.patientId, patientId), gt(appointments.startsAt, clockOf(context)))).orderBy(appointments.startsAt);
  const input: VisitSummaryInput = {
    sections: sections.filter(s => s.text.trim()),
    prescriptions: meds.map(m => ({ name: m.name, ...m.formulation && { detail: m.formulation }, ...m.change && { change: m.change }, ...m.from && { from: m.from } })),
    followUps: coming.map(a => `${a.kind} on ${a.startsAt.toISOString().slice(0, 10)}`),
  };
  return { patientId, input };
}

/** note.save by a doctor: one waiting draft per encounter, replaced while still a draft; an approved or dismissed one is never touched. */
export async function draftVisitSummaryFor(context: Pick<Context, "db" | "now" | "models">, hospitalId: string, encounterId: string, revision: number, sections: { id: string; text: string }[]) {
  const { patientId, input } = await visitInput(context, hospitalId, encounterId, sections);
  if (!input.sections.length) return;
  const drafted = await (context.models ?? stubModels).draftVisitSummary(input);
  await context.db.delete(visitSummaries).where(and(eq(visitSummaries.encounterId, encounterId), eq(visitSummaries.status, "draft")));
  await context.db.insert(visitSummaries).values({
    id: `vs-${encounterId}-${revision}`, hospitalId, patientId, encounterId, text: drafted.text, whatChanged: drafted.whatChanged,
    sources: sourcesOf(input), checks: checkSummary(drafted.text, input), origin: drafted.source, createdAt: clockOf(context),
  });
}

const waiting = (hospitalId: string, id: string) => and(eq(visitSummaries.id, id), eq(visitSummaries.hospitalId, hospitalId), eq(visitSummaries.status, "draft"));
const gone = () => new ORPCError("NOT_FOUND", { message: "That item is no longer waiting for review" });

/** One place to approve anything a patient will read. Only `visit-summary` for now; a `message-reply` item has the same shape. */
export const reviewRouter = {
  list: protectedProcedure.handler(async ({ context }) => {
    const rows = await context.db.select({ s: visitSummaries, name: patients.name }).from(visitSummaries).innerJoin(patients, eq(patients.id, visitSummaries.patientId))
      .where(and(eq(visitSummaries.hospitalId, context.hospitalId), eq(visitSummaries.status, "draft"))).orderBy(desc(visitSummaries.createdAt));
    return rows.map(({ s, name }) => ({ id: s.id, kind: "visit-summary" as const, patient: { id: s.patientId, name }, encounterId: s.encounterId,
      text: s.text, whatChanged: s.whatChanged, sources: s.sources, checks: s.checks, origin: s.origin, createdAt: s.createdAt }));
  }),
  /** `text` is the clinician's edit; the checks are re-run on it and stored, and the patient reads the approved text. */
  approve: protectedProcedure.input(z.object({ id: z.string().min(1), text: z.string().trim().min(1).max(4000).optional() })).handler(async ({ context, input }) => {
    const [row] = await context.db.select().from(visitSummaries).where(waiting(context.hospitalId, input.id));
    if (!row) throw gone();
    const approvedText = input.text ?? row.text;
    const { input: visit } = await visitInput(context, context.hospitalId, row.encounterId, row.sources.filter(s => s.kind === "note").map(s => ({ id: s.ref, text: s.text })));
    const checks = input.text ? checkSummary(approvedText, visit) : row.checks;
    const approvedAt = clockOf(context);
    const done = await context.db.update(visitSummaries).set({ status: "approved", approvedBy: context.session.user.id, approvedAt, approvedText, checks })
      .where(waiting(context.hospitalId, input.id)).returning({ id: visitSummaries.id });
    if (!done.length) throw gone();
    // Tells the patient's Sona Care, as a care-team message does; a failed announcement never fails the approval.
    if (context.announce) await context.announce(context.hospitalId, { topic: "visitSummaries", patientId: row.patientId }).catch(() => {});
    return { id: row.id, status: "approved" as const, text: approvedText, checks, approvedAt };
  }),
  dismiss: protectedProcedure.input(z.object({ id: z.string().min(1) })).handler(async ({ context, input }) => {
    const done = await context.db.update(visitSummaries).set({ status: "dismissed" }).where(waiting(context.hospitalId, input.id)).returning({ id: visitSummaries.id });
    if (!done.length) throw gone();
    return { id: input.id, status: "dismissed" as const };
  }),
};

/** Sona Care: the signed-in patient's own approved summaries, newest first. A draft or a dismissed one is never returned. */
export const careVisitSummariesRouter = {
  list: patientProcedure.handler(async ({ context }) => {
    const rows = await context.db.select().from(visitSummaries)
      .where(and(eq(visitSummaries.patientId, context.patientId), eq(visitSummaries.hospitalId, context.hospitalId), eq(visitSummaries.status, "approved")))
      .orderBy(desc(visitSummaries.approvedAt));
    // `at` is when the note was written (the visit), not when the summary was approved: the patient reads it as the visit's date.
    return rows.map(r => ({ id: r.id, at: r.createdAt, text: r.approvedText ?? r.text, whatChanged: r.whatChanged }));
  }),
};
