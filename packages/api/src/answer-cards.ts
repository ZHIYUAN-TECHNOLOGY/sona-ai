import { bookingRequests, doctors, encounters, labResults, observations, receipts } from "@sona-ai/db/schema/clinical";
import { cardsOf, type AnswerCard, type Mark, type MarkKind } from "@sona-ai/domain/answer-parts";
import { patientMeds, warningSigns, type PatientMed } from "@sona-ai/domain/care";
import { criticalOf } from "@sona-ai/domain/critical";
import type { Language } from "@sona-ai/domain/discharge";
import { rangeFlagOf, rangeWhy } from "@sona-ai/domain/lab-ranges";
import { and, asc, desc, eq, gte } from "drizzle-orm";

import { wordsIn } from "./chat-models";
import { clockOf, type Context } from "./context";
import { followUpsOf, planOf, type patientPlan } from "./routers/care-plan";
import { READING_KINDS } from "./routers/care-readings";

/**
 * The cards under a Sona answer (@sona-ai/domain/answer-parts, docs/answer-parts.md), built only from database rows: a
 * medicine, result, reading or visit the answer's words name (its marks, the model's choice), her come-back list when a
 * symptom on it is named, and the 999 card on an urgent turn. A word the model wrote that names no row of hers gives no
 * card (a medicine she does not take, a test she never had), and a patient sees a result's value only once a doctor has
 * acknowledged it, as her Results screen does (care-results).
 * care.ask calls careCards and ask.free proCards with what they already read; each reads only the rows its marks need.
 */
export const ANSWER_CARDS = 3;

type PatientContext = Context & { hospitalId: string; patientId: string };
type Plan = Awaited<ReturnType<typeof patientPlan>>;
/** A card the answer can bring up: the words that name it, and the kinds of mark that may. */
export type Named = { card: AnswerCard; names: string[]; on: MarkKind[] };
export type CardFacts = {
  named: Named[];
  /** Her plan's come-back list (warningSigns), in the answer's language. */
  signs?: string[];
  /** Her next visits as cards, earliest first, for an answer about her visits (`from`). */
  visits?: AnswerCard[];
};

/** What a card says in the patient's language (Sona Care's own words where it has them: ask.plan, hs.comeBack). */
const SAY = {
  plan: { en: "Your discharge plan", ms: "Pelan discaj anda", zh: "您的出院计划" },
  lab: { en: "Lab result", ms: "Keputusan makmal", zh: "化验结果" },
  stopped: { en: "Stopped", ms: "Dihentikan", zh: "已停用" },
  comeBack: { en: "Come back straight away if", ms: "Datang semula segera jika", zh: "出现以下情况请立即回来" },
  call999: { en: "Call 999 now", ms: "Hubungi 999 sekarang", zh: "请立即拨打999" },
} satisfies Record<string, Record<Language, string>>;
/** A home reading's name as she reads it (care-readings READING_KINDS has the English). */
const READING_WORDS: Record<keyof typeof READING_KINDS, Record<Exclude<Language, "en">, string>> = {
  blood_pressure: { ms: "Tekanan darah", zh: "血压" }, heart_rate: { ms: "Kadar nadi", zh: "心率" }, temperature: { ms: "Suhu", zh: "体温" },
  weight: { ms: "Berat badan", zh: "体重" }, blood_glucose: { ms: "Gula dalam darah", zh: "血糖" }, oxygen_saturation: { ms: "Tahap oksigen", zh: "血氧" },
};
/** Words cut to a card field's length, so a long plan line never drops its card (answer-parts refuses a card past its limits). */
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
/** Whether `a` holds `b` as whole words (either way round), case aside: "low potassium of 3.1" holds "Potassium". */
const names = (a: string, b: string) => b.length > 1 && a.length > 1 && (wordsIn(a, b).length > 0 || wordsIn(b, a).length > 0);
/** A symptom she named and a sign on her list share a word of four letters or more, or one holds the other ("fever", "The fever comes back"). */
const onList = (sign: string, said: string) => names(sign, said) || said.split(/\s+/).some(w => w.length >= 4 && wordsIn(sign, w).length > 0);
/** One card per thing: a medicine, test or reading by name, a visit by its time, one warning. */
const keyOf = (c: AnswerCard) => `${c.type}:${c.type === "medicine" ? c.name : c.type === "result" ? c.test : c.type === "reading" ? c.label : c.type === "appointment" ? c.when : c.type === "doctor" ? c.id : ""}`.toLowerCase();
const VISITS = new Set(["visits", "follow-up"]);

const warningCard = (level: "urgent" | "soon", lang: Language, signs: string[]): AnswerCard =>
  ({ type: "warning", level, title: (level === "urgent" ? SAY.call999 : SAY.comeBack)[lang], items: signs.slice(0, 8).map(s => clip(s, 160)) });

/**
 * The cards for an answer, most relevant first: the 999 card on an urgent turn, then each row the answer's marks name, in
 * the order the answer names them, her come-back list when it names a symptom on it (unless the answer is that list, `from`
 * "warning signs"), and her next visit when it answers from her visits; at most ANSWER_CARDS, each once.
 */
export function cardsFor(answer: { marks?: Mark[]; urgent?: boolean; from?: string }, facts: CardFacts, lang: Language = "en"): AnswerCard[] {
  const cards: AnswerCard[] = [];
  const add = (card?: AnswerCard) => { if (card && !cards.some(c => keyOf(c) === keyOf(card))) cards.push(card); };
  if (answer.urgent) add(warningCard("urgent", lang, facts.signs ?? []));
  for (const mark of answer.marks ?? []) {
    add(facts.named.find(n => n.on.includes(mark.kind) && n.names.some(name => names(mark.text, name)))?.card);
    if ((mark.kind === "symptom" || mark.kind === "warning") && answer.from !== "warning signs" && facts.signs?.some(s => onList(s, mark.text))) add(warningCard("soon", lang, facts.signs));
  }
  if (VISITS.has(answer.from ?? "") && !cards.some(c => c.type === "appointment")) add(facts.visits?.[0]);
  return cardsOf(cards).slice(0, ANSWER_CARDS);
}

/** Her plan's medicines as cards: how to take one dose, its times and the plan's line; a stopped one says so. */
export function planMedicines(medicines: Extract<Plan, { status: "discharged" }>["medicines"], lang: Language): Named[] {
  return Object.entries(medicines).flatMap(([group, list]) => list.map((m: PatientMed) => ({
    names: [m.name], on: ["medicine"] as MarkKind[],
    card: {
      type: "medicine" as const, name: clip(m.name, 80), ...m.take && !m.finished && { dose: clip(m.take, 80) }, how: clip(m.line, 160),
      ...m.at?.length && !m.finished && group !== "stopped" && { times: m.at }, ...group === "stopped" && { note: SAY.stopped[lang] }, source: SAY.plan[lang],
    },
  })));
}

type LabRow = typeof labResults.$inferSelect;
/** A result as a card: its flag from the lab, else the usual range (critical past the call-now limit), and the range in words when it is out of it. */
export function resultCard(r: Pick<LabRow, "test" | "value" | "unit" | "flag" | "receivedAt">, lang: Language): Named {
  const flag = criticalOf(r) || r.flag?.startsWith("critical") ? "critical" : r.flag === "high" || r.flag === "low" || r.flag === "normal" ? r.flag : rangeFlagOf(r);
  // ponytail: the usual range is only worded for a flagged result in English (rangeWhy); lab-ranges exporting its range would show it always.
  const range = lang === "en" ? rangeWhy(r)?.match(/usual adult range of (.+)$/)?.[1] : undefined;
  return {
    names: [r.test], on: ["test", "warning", "caution"],
    card: { type: "result", test: clip(r.test, 80), value: clip(r.value, 40), ...r.unit && { unit: clip(r.unit, 20) }, ...flag && { flag }, ...range && { range: clip(range, 60) }, at: r.receivedAt.toISOString(), source: SAY.lab[lang] },
  };
}

/**
 * Her visits still to come, earliest first, as cards: the ones her Schedule shows (followUpsOf: booked, recalls, the
 * discharge review) and the times she asked for that the care team has yet to confirm (as visitsText reads them).
 */
async function careVisits(context: PatientContext, lang: Language): Promise<AnswerCard[]> {
  const { db, hospitalId, patientId } = context;
  const [visits, asked] = await Promise.all([
    followUpsOf(context, lang),
    db.select({ doctor: doctors.name, specialty: doctors.specialty, room: doctors.room, at: bookingRequests.startsAt }).from(bookingRequests).innerJoin(doctors, eq(doctors.id, bookingRequests.doctorId))
      .where(and(eq(bookingRequests.hospitalId, hospitalId), eq(bookingRequests.patientId, patientId), eq(bookingRequests.status, "requested"), gte(bookingRequests.startsAt, clockOf(context)))),
  ]);
  const coming = [
    ...visits.filter(v => v.status === "upcoming" || v.status === "due-soon").map(v => ({ title: v.title, date: v.date, status: v.status })),
    ...asked.map(r => ({ title: `${r.doctor}, ${r.specialty}`, date: r.at, status: "requested" as const, where: r.room })),
  ];
  return coming.sort((a, b) => a.date.getTime() - b.date.getTime())
    .map(v => ({ type: "appointment", title: clip(v.title, 120), when: v.date.toISOString(), ..."where" in v && { where: clip(v.where, 120) }, status: v.status }));
}

/** Her own home readings (care-readings), the latest of each kind, named in her language and in English. */
async function homeReadings(context: PatientContext, lang: Language): Promise<Named[]> {
  const rows = await context.db.select().from(observations).where(and(eq(observations.patientId, context.patientId), eq(observations.source, "patient"))).orderBy(desc(observations.observedAt));
  const lower = new Map(rows.map(r => [r.id, r.value]));
  const latest = [...new Map(rows.filter(r => r.kind in READING_KINDS).reverse().map(r => [r.kind, r])).values()];
  return latest.map(r => {
    const kind = r.kind as keyof typeof READING_KINDS, label = lang === "en" ? READING_KINDS[kind].label : READING_WORDS[kind][lang], low = lower.get(`${r.id}-d`);
    return { names: [label, READING_KINDS[kind].label], on: ["test", "warning", "caution"], card: { type: "reading", label, value: low === undefined ? `${r.value}` : `${r.value}/${low}`, unit: r.unit, at: r.observedAt.toISOString() } };
  });
}

/**
 * care.ask's cards (cardsFor) for a model answer, from her record: `plan` is the one recordText already read (in English,
 * read again in her language for a Malay or Chinese answer, from the plan alone). Only what the marks need is read: her
 * released results for a test, warning or caution, her home readings for a test, her visits for an answer from them.
 * ponytail: medicines come from the take-home plan only; one still in hospital gets none (her prescriptions are lines today).
 */
export async function careCards(context: PatientContext, input: { plan: Plan; marks?: Mark[]; urgent?: boolean; from?: string; language: Language }): Promise<AnswerCard[]> {
  const { db, hospitalId, patientId } = context, lang = input.language, kinds = new Set(input.marks?.map(m => m.kind));
  const home = input.plan.status === "discharged" ? input.plan : undefined;
  const wanted = (...k: MarkKind[]) => k.some(kind => kinds.has(kind));
  const [planned, labs, readings, visits] = await Promise.all([
    home && (input.urgent || wanted("medicine", "symptom", "warning"))
      ? lang === "en" ? { medicines: home.medicines, signs: home.warningSigns }
        : planOf(db, hospitalId, patientId).then(p => ({ medicines: patientMeds(p, lang, { out: home.dischargedAt, now: clockOf(context) }), signs: warningSigns(p, lang) }))
      : undefined,
    wanted("test", "warning", "caution") ? db.select().from(labResults).where(eq(labResults.patientId, patientId)).orderBy(desc(labResults.receivedAt)) : [],
    wanted("test") ? homeReadings(context, lang) : [],
    VISITS.has(input.from ?? "") ? careVisits(context, lang) : [],
  ]);
  // Released to her as on her Results screen (care-results): acknowledged by a doctor, and not a sample still at the lab.
  const released = labs.filter(r => r.acknowledgedAt !== null && r.flag !== "pending" && r.value);
  return cardsFor(input, { named: [...planned ? planMedicines(planned.medicines, lang) : [], ...released.map(r => resultCard(r, lang)), ...readings], signs: planned?.signs, visits }, lang);
}

/**
 * ask.free's cards for an answer asked on a visit (`encounterId`, of the clinician's hospital): the visit's patient's
 * prescriptions (the newest of each medicine, as care-plan's prescribed reads them), results (every one with a value: a
 * clinician sees them before acknowledging) and ward readings (the latest of each kind), each when the marks name it.
 * None off a visit: a Today or Ward answer names many patients.
 */
export async function proCards(context: Context & { hospitalId: string }, input: { encounterId?: string; marks?: Mark[] }): Promise<AnswerCard[]> {
  const { db, hospitalId } = context, kinds = new Set(input.marks?.map(m => m.kind));
  if (!input.encounterId || !kinds.size) return [];
  const [visit] = await db.select({ patientId: encounters.patientId }).from(encounters).where(and(eq(encounters.id, input.encounterId), eq(encounters.hospitalId, hospitalId)));
  if (!visit) return [];
  const results = kinds.has("test") || kinds.has("warning") || kinds.has("caution");
  const [ordered, labs, chart] = await Promise.all([
    kinds.has("medicine") ? db.select({ payload: receipts.payload }).from(receipts).innerJoin(encounters, eq(encounters.id, receipts.encounterId))
      .where(and(eq(receipts.kind, "prescription"), eq(encounters.patientId, visit.patientId), eq(encounters.hospitalId, hospitalId))).orderBy(desc(receipts.createdAt)) : [],
    results ? db.select().from(labResults).where(eq(labResults.patientId, visit.patientId)).orderBy(desc(labResults.receivedAt)) : [],
    results ? db.select().from(observations).where(and(eq(observations.patientId, visit.patientId), eq(observations.source, "clinical"))).orderBy(asc(observations.observedAt)) : [],
  ]);
  type Ordered = { medication?: string; formulation?: string; dose?: string; unit?: string; route?: string; frequency?: string; duration?: string };
  const newest = new Map<string, Ordered>();
  for (const { payload } of ordered) { const r = payload as Ordered; if (r.medication && !newest.has(r.medication.toLowerCase())) newest.set(r.medication.toLowerCase(), r); }
  const medicines: Named[] = [...newest.values()].map(r => ({
    names: [r.medication!], on: ["medicine"],
    card: { type: "medicine", name: clip(r.medication!, 80), ...r.dose && { dose: clip([r.dose, r.unit, r.formulation].filter(Boolean).join(" "), 80) }, how: clip([r.route, r.frequency, r.duration && `for ${r.duration}`].filter(Boolean).join(", ") || "As prescribed", 160), source: "Prescription" },
  }));
  const vitals: Named[] = [...new Map(chart.map(o => [o.kind, o])).values()].map(o => {
    const label = o.unit === "AMT" ? "AMT" : o.kind.charAt(0).toUpperCase() + o.kind.slice(1).replace(/[-_]/g, " ");
    return { names: [label], on: ["test", "warning", "caution"], card: { type: "reading", label: clip(label, 60), value: o.unit === "AMT" ? `${o.value}/10` : `${o.value}`, unit: clip(o.unit, 20), at: o.observedAt.toISOString() } };
  });
  return cardsFor(input, { named: [...medicines, ...labs.filter(r => r.flag !== "pending" && r.value).map(r => resultCard(r, "en")), ...vitals] });
}
