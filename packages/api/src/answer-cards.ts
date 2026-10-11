import { bookingRequests, doctors, encounters, labResults, observations, receipts } from "@sona-ai/db/schema/clinical";
import { cardsOf, type AnswerCard, type Lane, type Mark, type MarkKind } from "@sona-ai/domain/answer-parts";
import { patientMeds, warningSigns, type PatientMed } from "@sona-ai/domain/care";
import { criticalOf } from "@sona-ai/domain/critical";
import type { Language } from "@sona-ai/domain/discharge";
import type { Doctor } from "@sona-ai/domain/doctors";
import { MISSED_AFTER, doseKey, doseSlots } from "@sona-ai/domain/doses";
import { rangeFlagOf, rangeWhy } from "@sona-ai/domain/lab-ranges";
import { and, asc, desc, eq, gte } from "drizzle-orm";

import { wordsIn } from "./chat-models";
import { clockOf, type Context } from "./context";
import { doctorsFor } from "./routers/bookings";
import { followUpsOf, lastDischarge, planOf, takenKeys, type patientPlan } from "./routers/care-plan";
import { READING_KINDS } from "./routers/care-readings";

/**
 * The cards under a Sona answer (@sona-ai/domain/answer-parts, docs/answer-parts.md), built only from database rows: a
 * medicine, result, reading or visit the answer's words name (its marks, the model's choice), her come-back list when a
 * symptom on it is named, and the 999 card on an urgent turn. A word the model wrote that names no row of hers gives no
 * card (a medicine she does not take, a test she never had), and a patient sees a result's value only once a doctor has
 * acknowledged it, as her Results screen does (care-results). The Clef fast lane's turns get their cards here too
 * (careLaneCards, proLaneCards): drafts she or the clinician confirms before anything happens.
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

/** What a card says in the patient's language (Sona Care's own words where it has them: ask.plan, hs.comeBack, book.*). */
const SAY = {
  plan: { en: "Your discharge plan", ms: "Pelan discaj anda", zh: "您的出院计划" },
  lab: { en: "Lab result", ms: "Keputusan makmal", zh: "化验结果" },
  stopped: { en: "Stopped", ms: "Dihentikan", zh: "已停用" },
  comeBack: { en: "Come back straight away if", ms: "Datang semula segera jika", zh: "出现以下情况请立即回来" },
  call999: { en: "Call 999 now", ms: "Hubungi 999 sekarang", zh: "请立即拨打999" },
  visitWith: { en: "Visit with", ms: "Lawatan dengan", zh: "复诊医生：" },
  bookWhat: { en: "This asks your care team for this time. It is booked once they confirm; you will see it on your Schedule.", ms: "Ini meminta masa ini daripada pasukan penjagaan anda. Ia ditempah selepas mereka sahkan; anda akan melihatnya dalam Jadual anda.", zh: "这是向医护团队申请这个时间。他们确认后才算预约成功，您会在日程上看到。" },
  bookConfirm: { en: "Send request", ms: "Hantar permintaan", zh: "发送申请" },
  bookDone: { en: "Request sent. Your care team will confirm the time.", ms: "Permintaan dihantar. Pasukan penjagaan anda akan mengesahkan masanya.", zh: "申请已发送。医护团队会确认时间。" },
  doseWhat: { en: "Marks this dose as taken. Your care team sees it.", ms: "Tandakan dos ini sebagai sudah diambil. Pasukan penjagaan anda dapat melihatnya.", zh: "把这一剂标记为已服用。医护团队可以看到。" },
  doseConfirm: { en: "Mark as taken", ms: "Tanda sudah diambil", zh: "标记为已服用" },
  doseDone: { en: "Marked as taken.", ms: "Sudah ditanda diambil.", zh: "已标记为已服用。" },
  readingWhat: { en: "Saves it to your readings. Your care team sees it.", ms: "Simpan dalam bacaan anda. Pasukan penjagaan anda dapat melihatnya.", zh: "保存到您的测量记录。医护团队可以看到。" },
  readingConfirm: { en: "Save reading", ms: "Simpan bacaan", zh: "保存测量" },
  readingDone: { en: "Saved to your readings.", ms: "Disimpan dalam bacaan anda.", zh: "已保存到您的测量记录。" },
} satisfies Record<string, Record<Language, string>>;
/** A home reading's name as she reads it (care-readings READING_KINDS has the English). */
const READING_WORDS: Record<keyof typeof READING_KINDS, Record<Exclude<Language, "en">, string>> = {
  blood_pressure: { ms: "Tekanan darah", zh: "血压" }, heart_rate: { ms: "Kadar nadi", zh: "心率" }, temperature: { ms: "Suhu", zh: "体温" },
  weight: { ms: "Berat badan", zh: "体重" }, blood_glucose: { ms: "Gula dalam darah", zh: "血糖" }, oxygen_saturation: { ms: "Tahap oksigen", zh: "血氧" },
};
const LOCALE: Record<Language, string> = { en: "en-GB", ms: "ms-MY", zh: "zh-CN" };
/** "Thu 15 Oct at 10:30", "Kha, 15 Okt, 10:30 PG", in Malaysia time. */
const dayTime = (at: Date, lang: Language) => at.toLocaleString(LOCALE[lang], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" });
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

/**
 * What the fast lane read in the turn besides its intent, all optional: the medicine she took, the doctor or specialty and
 * time she asked for, the reading she gave, the task the clinician dictated. The app's own call checks each again.
 */
export type LaneSaid = {
  medicine?: string; doctor?: string; startsAt?: Date; reason?: string;
  reading?: { kind: string; value: number; value2?: number; takenAt?: Date };
  task?: { encounterId: string; title: string; owner: string; due?: string };
};

/** A drafted visit request: the doctor's card, then the time she asked for when it is free, else the doctor's first free one (care.bookings.request). */
export function bookCards(found: (Pick<Doctor, "id" | "name" | "specialty" | "room" | "rating" | "careTeam"> & { nextSlots: { times: Date[] }[] })[], said: LaneSaid, lang: Language): AnswerCard[] {
  const doctor = found[0];
  if (!doctor) return [];
  const free = doctor.nextSlots.flatMap(d => d.times), at = said.startsAt && free.find(t => t.getTime() === said.startsAt!.getTime()) || free[0];
  const card: AnswerCard = { type: "doctor", id: doctor.id, name: doctor.name, specialty: doctor.specialty, room: doctor.room, rating: doctor.rating, ...doctor.careTeam !== undefined && { careTeam: doctor.careTeam } };
  if (!at) return [card];
  return [card, {
    type: "action", do: "book", title: clip(`${SAY.visitWith[lang]} ${doctor.name}`, 160), items: [dayTime(at, lang), clip(doctor.room, 160)],
    what: SAY.bookWhat[lang], confirm: SAY.bookConfirm[lang], done: SAY.bookDone[lang],
    payload: { doctorId: doctor.id, startsAt: at.toISOString(), ...said.reason?.trim() && { reason: clip(said.reason.trim(), 200) } },
  }];
}

/**
 * The dose she most likely means to mark taken: of her timed take-home medicines (the one she named, when she did), the
 * latest dose due by an hour from now and not yet past being missed, that she has not marked; none when there is none.
 */
export function doseCard(medicines: PatientMed[], out: Date, taken: string[], now: Date, said: LaneSaid, lang: Language): AnswerCard[] {
  const due = medicines.filter(m => m.at?.length && !m.finished && (!said.medicine || names(said.medicine, m.name)))
    .flatMap(m => doseSlots(m, out, new Date(now.getTime() + 3600_000)).map(at => ({ m, at, key: doseKey(m.name, at) })))
    .filter(d => now.getTime() - d.at.getTime() < MISSED_AFTER && !taken.includes(d.key)).sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  if (!due) return [];
  return [{
    type: "action", do: "logDose", title: clip(`${due.m.name} · ${dayTime(due.at, lang)}`, 160), ...due.m.take && { items: [clip(due.m.take, 160)] },
    what: SAY.doseWhat[lang], confirm: SAY.doseConfirm[lang], done: SAY.doseDone[lang], payload: { key: due.key },
  }];
}

/** A drafted home reading (care.readings.add), only when it is one a person can show (READING_KINDS' ranges; a blood pressure needs both numbers, the upper first). */
export function readingCard(reading: LaneSaid["reading"], lang: Language): AnswerCard[] {
  const kind = reading && READING_KINDS[reading.kind as keyof typeof READING_KINDS];
  if (!reading || !kind || reading.value < kind.min || reading.value > kind.max) return [];
  const bp = reading.kind === "blood_pressure";
  if (bp && (reading.value2 === undefined || reading.value2 >= reading.value || reading.value2 < 30 || reading.value2 > 160)) return [];
  const label = lang === "en" ? kind.label : READING_WORDS[reading.kind as keyof typeof READING_KINDS][lang];
  return [{
    type: "action", do: "logReading", title: clip(`${label} ${reading.value}${bp ? `/${reading.value2}` : ""} ${kind.unit}`, 160), what: SAY.readingWhat[lang], confirm: SAY.readingConfirm[lang], done: SAY.readingDone[lang],
    payload: { kind: reading.kind, value: reading.value, ...bp && { value2: reading.value2 }, ...reading.takenAt && { takenAt: reading.takenAt.toISOString() } },
  }];
}

/** Sona Care's fast-lane turns: her next visits, a drafted visit request, the dose to mark taken, the reading to save. */
export async function careLaneCards(context: PatientContext, input: { intent: Lane["intent"]; said?: LaneSaid; language: Language }): Promise<AnswerCard[]> {
  const { db, hospitalId, patientId } = context, said = input.said ?? {}, lang = input.language, now = clockOf(context);
  if (input.intent === "next_appointment") return (await careVisits(context, lang)).slice(0, ANSWER_CARDS);
  if (input.intent === "book_appointment") {
    // The doctor or specialty she named, else her care team.
    const named = said.doctor ? await doctorsFor(context, said.doctor) : [];
    return cardsOf(bookCards(named.length ? named : (await doctorsFor(context)).filter(d => d.careTeam), said, lang));
  }
  if (input.intent === "log_reading") return cardsOf(readingCard(said.reading, lang));
  if (input.intent === "log_dose") {
    const [left, plan, taken] = await Promise.all([lastDischarge(db, hospitalId, patientId), planOf(db, hospitalId, patientId), takenKeys(db, hospitalId, patientId)]);
    if (!left) return [];
    const m = patientMeds(plan, lang, { out: left.dischargedAt, now });
    return cardsOf(doseCard([...m.new, ...m.changed, ...m.continue], new Date(left.dischargedAt), taken, now, said, lang));
  }
  return [];
}

/** Sona Pro's fast-lane turns: a drafted task for the visit (tasks.create; the app adds requestId). A ward overview is the ward's own rows (ask-context), so no cards. */
export function proLaneCards(input: { intent: Lane["intent"]; said?: LaneSaid }): AnswerCard[] {
  const task = input.said?.task;
  if (input.intent !== "create_task" || !task?.title.trim() || !task.owner.trim()) return [];
  return cardsOf([{
    type: "action", do: "createTask", title: "New task", items: [clip(task.title, 160), clip(`Owner: ${task.owner}`, 160), ...task.due ? [`Due ${task.due}`] : []],
    what: "Adds it to this visit's tasks.", confirm: "Create task", done: "Task created.",
    payload: { encounterId: task.encounterId, title: clip(task.title.trim(), 200), owner: clip(task.owner.trim(), 80), ...task.due && { due: task.due } },
  }]);
}
