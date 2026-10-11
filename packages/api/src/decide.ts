import { appointments, bookingRequests, doctors } from "@sona-ai/db/schema/clinical";
import { LANE_INTENTS, cardsOf, type AnswerCard, type Lane, type Mark } from "@sona-ai/domain/answer-parts";
import { patientMeds } from "@sona-ai/domain/care";
import type { Language } from "@sona-ai/domain/discharge";
import { shortName } from "@sona-ai/domain/doctors";
import { MISSED_AFTER, doseKey, doseSlots } from "@sona-ai/domain/doses";
import { and, asc, eq, gte, inArray } from "drizzle-orm";

import { ruleFor, webPage } from "./ask-context";
import { checkAskSpec } from "./ask-spec";
import { clockOf, type Context } from "./context";
import { PASSAGES_MS } from "./leaflets";
import type { Role } from "./roles";
import { doctorsFor } from "./routers/bookings";
import { followUpsOf, lastDischarge, planOf, takenKeys } from "./routers/care-plan";
import { READING_KINDS } from "./routers/care-readings";
import type { WorkersAi } from "./workers-models";

/**
 * The Clef fast lane (docs/answer-parts.md). clef-omni on Workers AI reads what a patient or a doctor just said, beside
 * the usual answer: what they want, how sure it is, whether they also ask a question or call something off, and how
 * likely it is an emergency happening now. When it is sure of a lane turn (book, next visit, a dose or a reading in Sona
 * Care; a task or the ward's list in Sona Pro), Sona answers it at once from the database without Gemma; anything else
 * Gemma answers as before, and Clef's read is only logged. Its emergency read always reaches the care team.
 * Approved for routing and triage only (Jay, 11 Oct: an exception to Malaysia-only), so it is sent the words and a fixed
 * line about the app, nothing from the record. Rules and numbers from the Clef trial (11 Oct, .scratch-eval/clef-trial).
 */
export const CLEF_MODEL = "@cf/cloudflare/clef-omni";
export type App = keyof typeof LANE_INTENTS;

/** Clef's whole read gets as long as the leaflet search it runs beside, then the turn goes on without it. */
export const DECIDE_MS = PASSAGES_MS;
/** A lane turn needs this confidence: 44 of the trial's 160 turns, none wrong, and no medical or emergency question. */
export const LANE_AT = 0.7;
/** Emergency at this probability or more: all 14 of the trial's emergencies, and no other question (the highest was 0.22). */
export const EMERGENCY_AT = 0.25;
/** A yes from a yes-or-no question. ponytail: not measured (the trial asked none); unsure turns go to Gemma, the safe side. */
const YES_AT = 0.5;
/** The words that always keep a turn off the lane (trial rules): the lane never cancels, waits or undoes anything. */
const CALL_OFF = /\b(cancel|wait|undo|batal)\b|取消/i;

/** The trial's intent questions, word for word (clef_config.json): its numbers hold for these. */
const INTENT = {
  care: {
    type: "choice", instructions: "What does the patient want from this spoken message?",
    criteria: {
      medical_question: "any health, symptom, medicine, result or care question that needs an answer",
      book_appointment: "book, change or request a visit",
      log_dose: "says they just took a dose",
      log_reading: "tells a home reading: BP, sugar, temperature, weight",
      next_appointment: "asks when or where the next visit is",
      emergency: "reports an emergency sign happening NOW: chest pain, severe breathlessness, confusion, fainting, coughing blood, heavy bleeding, a floppy or drowsy baby",
      other: "thanks, small talk, unclear",
    },
  },
  pro: {
    type: "choice", instructions: "What does the doctor want from this spoken message?",
    criteria: {
      patient_data: "labs, vitals, meds, allergies, notes or imaging of a patient",
      order_draft: "start, stop or change a medicine order",
      create_task: "remind me, follow-up, or a task for someone",
      document_draft: "discharge summary, handover, referral or note",
      clinical_reasoning: "differential, is she fit for discharge, interpretation",
      guideline_question: "evidence or guideline, not about this patient's data",
      ward_overview: "who needs me, which beds, what's overdue",
      other: "anything else: thanks, small talk, unclear",
    },
  },
} as const;

/** What each app asks Clef in one call: the intent, then yes-or-no and choice questions the lane needs. */
const QUESTIONS = {
  care: {
    intent: INTENT.care,
    asks_question: { type: "noul", instructions: "Apart from booking, a visit's time or place, or a dose or reading they took, does the message also ask a health, medicine or result question that needs an answer?" },
    cancels: { type: "noul", instructions: "Does the message cancel, undo or put off something, or say wait or never mind?" },
    reading: {
      type: "choice", instructions: "Which home reading does the message give, if any?",
      criteria: {
        blood_pressure: "blood pressure (BP), two numbers", heart_rate: "pulse or heart rate", temperature: "body temperature",
        weight: "body weight", blood_glucose: "blood sugar or glucose", oxygen_saturation: "oxygen level (SpO2)", none: "no home reading",
      },
    },
  },
  pro: {
    intent: INTENT.pro,
    asks_question: { type: "noul", instructions: "Apart from a task or the ward's list, does the message also ask a clinical question that needs an answer (a result, a diagnosis, a treatment)?" },
    cancels: { type: "noul", instructions: "Does the message cancel, undo or put off something, or say wait or never mind?" },
    owner: {
      type: "choice", instructions: "Who should do the task the doctor asks for?",
      criteria: { self: "the doctor speaking (remind me, I will)", house_officer: "the house officer, HO or a junior doctor", nurse: "a nurse or the nursing team", night_team: "the night team or the doctor on call", other: "someone else, or not said" },
    },
    due: { type: "choice", instructions: "When is the task due?", criteria: { today: "today, tonight or a time today", tomorrow: "tomorrow", later: "a later day, or not said" } },
  },
};

/** The whole state Clef is sent beside the words: one fixed line about who is speaking, nothing from a record. */
const STATE = {
  care: () => ({ patient: "A patient of this hospital, writing or speaking to its Sona Care app." }),
  pro: (open?: boolean) => ({ context: `A doctor on a ward round, speaking to Sona Pro.${open ? " A patient's visit is open on screen." : ""}` }),
};

/** Clef's read of one turn. */
export type Decision = {
  intent: string;
  /** Clef's own confidence in `intent` (not its top probability). */
  confidence: number;
  probabilities: Record<string, number>;
  /** The probability she reports an emergency now; 0 in Sona Pro, which has no such intent. */
  emergency: number;
  asksQuestion: boolean;
  cancels: boolean;
  /** Its other choices by question: Care `reading`; Pro `owner` and `due`. */
  picks: Record<string, string>;
};

/** The Clef binding while CLEF_LANE is "1"; none otherwise, and then Clef is never called. */
export const clefOf = (env: { CLEF_LANE?: string; AI?: WorkersAi }) => env.CLEF_LANE === "1" ? env.AI : undefined;

/**
 * Clef's read of what was said (`open`: a visit is open on Sona Pro's screen), or none: no binding (the flag is off),
 * a failure, an answer out of shape, or no answer within `ms`. It never throws, so nothing waits on it longer than `ms`.
 */
export async function decideTurn(ai: WorkersAi | undefined, turn: { app: App; said: string; open?: boolean }, ms = DECIDE_MS): Promise<Decision | undefined> {
  if (!ai) return undefined;
  const began = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const late = new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), ms); });
    const input = { model: "clef-omni", state: { ...STATE[turn.app](turn.open), said: turn.said.slice(0, 2000) }, questions: QUESTIONS[turn.app] };
    const decision = readDecision(await Promise.race([ai.run(CLEF_MODEL, input, { signal: AbortSignal.timeout(ms) }), late]), turn.app);
    // Telemetry only: what Clef read and how fast, never the words.
    const { probabilities: _, picks: __, ...read } = decision ?? {};
    console.log(JSON.stringify({ clef: turn.app, ms: Date.now() - began, ...decision ? read : { read: false } }));
    return decision;
  } catch (error) {
    console.error("clef not read", error);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

type Answer = { choice?: unknown; probabilities?: unknown; confidence?: unknown; noul?: unknown };
function readDecision(out: unknown, app: App): Decision | undefined {
  const answers = (out as { answers?: Record<string, Answer | undefined> } | undefined)?.answers, intent = answers?.intent;
  const options = Object.keys(INTENT[app].criteria);
  if (!answers || typeof intent?.choice !== "string" || !options.includes(intent.choice) || typeof intent.confidence !== "number") return undefined;
  // A probability per option, by name or (as the trial stored them) in the criteria's order.
  const p = intent.probabilities as Record<string, unknown> | unknown[] | undefined;
  const probabilities = Object.fromEntries(options.flatMap((o, i) => {
    const v = Array.isArray(p) ? p[i] : p?.[o];
    return typeof v === "number" && Number.isFinite(v) ? [[o, v]] : [];
  }));
  // A yes-or-no Clef did not answer counts as yes: a question asked, something called off (both keep the turn off the lane).
  const yes = (a?: Answer) => typeof a?.noul !== "number" || a.noul >= YES_AT;
  const picks = Object.fromEntries(Object.entries(answers).flatMap(([id, a]) => id !== "intent" && typeof a?.choice === "string" ? [[id, a.choice]] : []));
  return {
    intent: intent.choice, confidence: Math.min(1, Math.max(0, intent.confidence)), probabilities,
    emergency: probabilities.emergency ?? (intent.choice === "emergency" ? 1 : 0),
    asksQuestion: yes(answers.asks_question), cancels: yes(answers.cancels), picks,
  };
}

/** Whether Clef read an emergency happening now (for the calls and the chat agent, which take no lane). */
export const emergencyOf = (ai: WorkersAi | undefined, said: string) =>
  decideTurn(ai, { app: "care", said }).then(d => Boolean(d && d.emergency >= EMERGENCY_AT));

/**
 * The lane this turn takes, or none (Gemma answers): one of the app's lane intents, read with LANE_AT confidence or
 * more, asking no question besides, calling nothing off, and no emergency in it (Clef's, or the 999 words: `urgent`).
 */
export function laneOf(decision: Decision | undefined, app: App, said: string, urgent = false): Lane | undefined {
  if (!decision || urgent || decision.confidence < LANE_AT || decision.asksQuestion || decision.cancels || decision.emergency >= EMERGENCY_AT || CALL_OFF.test(said)) return undefined;
  if (!(LANE_INTENTS[app] as readonly string[]).includes(decision.intent)) return undefined;
  return { intent: decision.intent as Lane["intent"], confidence: decision.confidence, by: "clef-omni" };
}

// --- Sona Care's lane answers ---------------------------------------------------------------------------------------

type PatientContext = Context & { hospitalId: string; patientId: string };
/**
 * A lane answer in Sona Care: Sona's own line in her language, the words to colour in it, and cards from her record.
 * Always `grounded` (her visits, doses, the reading she gave, her care team), so no app captions it a general answer.
 */
export type LaneAnswer = { answer: string; grounded: boolean; from?: string; marks: Mark[]; cards: AnswerCard[] };
type Draft = { what: string; confirm: string; done: string };
type Kind = keyof typeof READING_KINDS;

/** Sona's lane lines, worded as Sona Care's app words them (the Doctors tab, her care team). */
const SAY: Record<Language, {
  book(doctor: string, when: string): string; booking: Draft;
  next(title: string, when: string, where?: string): string; noVisit: string;
  dose(name: string, when: string): string; dosing: Draft;
  reading(reading: string): string; saving: Draft;
  plan: string; kinds: Record<Kind, string>;
}> = {
  en: {
    book: (doctor, when) => `The first free time with ${doctor} is ${when}. You can ask for it, or another time on Doctors; your care team confirms it.`,
    booking: { what: "Your care team confirms the time and lets you know.", confirm: "Request this time", done: "Requested. Your care team will confirm it." },
    next: (title, when, where) => `Your next visit is ${title}, ${when}${where ? `, at ${where}` : ""}.`,
    noVisit: "You have no visit booked. To book one, pick a doctor and a time on Doctors.",
    dose: (name, when) => `Your ${name} dose due ${when} is ready to mark as taken.`,
    dosing: { what: "Marks this dose taken, so your care team sees it.", confirm: "Mark taken", done: "Marked as taken." },
    reading: reading => `${reading}, ready to save to your readings.`,
    saving: { what: "Saves it to your readings, so your care team sees it.", confirm: "Save reading", done: "Saved to your readings." },
    plan: "Your discharge plan",
    kinds: { blood_pressure: "Blood pressure", heart_rate: "Heart rate", temperature: "Temperature", weight: "Weight", blood_glucose: "Blood glucose", oxygen_saturation: "Oxygen saturation" },
  },
  ms: {
    book: (doctor, when) => `Masa kosong terawal dengan ${doctor} ialah ${when}. Anda boleh memintanya, atau masa lain di Doktor; pasukan penjagaan anda akan mengesahkannya.`,
    booking: { what: "Pasukan penjagaan anda mengesahkan masa dan memaklumkan anda.", confirm: "Minta masa ini", done: "Sudah diminta. Pasukan penjagaan anda akan mengesahkannya." },
    next: (title, when, where) => `Lawatan anda yang seterusnya: ${title}, ${when}${where ? `, di ${where}` : ""}.`,
    noVisit: "Anda belum ada lawatan. Untuk menempah, pilih doktor dan masa di Doktor.",
    dose: (name, when) => `Dos ${name} anda pada ${when} sedia untuk ditanda sudah diambil.`,
    dosing: { what: "Tanda dos ini sudah diambil, supaya pasukan penjagaan anda nampak.", confirm: "Tanda sudah ambil", done: "Sudah ditanda diambil." },
    reading: reading => `${reading}, sedia untuk disimpan dalam bacaan anda.`,
    saving: { what: "Simpan dalam bacaan anda, supaya pasukan penjagaan anda nampak.", confirm: "Simpan bacaan", done: "Sudah disimpan dalam bacaan anda." },
    plan: "Pelan discaj anda",
    kinds: { blood_pressure: "Tekanan darah", heart_rate: "Kadar nadi", temperature: "Suhu badan", weight: "Berat badan", blood_glucose: "Gula dalam darah", oxygen_saturation: "Tahap oksigen" },
  },
  zh: {
    book: (doctor, when) => `${doctor}最早的空档是${when}。您可以申请这个时间，或在“医生”页选择其他时间；护理团队会确认。`,
    booking: { what: "护理团队会确认时间并通知您。", confirm: "申请这个时间", done: "已申请，护理团队会确认。" },
    next: (title, when, where) => `您的下一次预约：${title}，${when}${where ? `，地点：${where}` : ""}。`,
    noVisit: "您还没有预约。要预约，请在“医生”页选择医生和时间。",
    dose: (name, when) => `您${when}的${name}可以标记为已服用。`,
    dosing: { what: "标记这一剂已服用，护理团队可以看到。", confirm: "标记已服用", done: "已标记为已服用。" },
    reading: reading => `${reading}，可以保存到您的测量记录。`,
    saving: { what: "保存到您的测量记录，护理团队可以看到。", confirm: "保存读数", done: "已保存到您的测量记录。" },
    plan: "您的出院计划",
    kinds: { blood_pressure: "血压", heart_rate: "心率", temperature: "体温", weight: "体重", blood_glucose: "血糖", oxygen_saturation: "血氧" },
  },
};

const LOCALE: Record<Language, string> = { en: "en-GB", ms: "ms-MY", zh: "zh-CN" };
/** A day and time as she reads them, in Malaysia time ("Thu 15 Oct, 10:30"); `day` alone for a visit with no set time. */
const whenOf = (at: Date, language: Language, day = false) =>
  at.toLocaleString(LOCALE[language], { weekday: "short", day: "numeric", month: "short", ...!day && { hour: "2-digit", minute: "2-digit", hour12: false }, timeZone: "Asia/Kuala_Lumpur" });

/** A dose may be marked from this long before it is due (she took it a little early). */
const EARLY_MS = 3600_000;

/**
 * Sona Care's answer to a lane turn, from her record and the hospital's directory; none when it has nothing sure to say
 * (no free doctor, no open dose of one medicine, a reading's numbers unclear), and Gemma answers instead. Every card is
 * read back through `cardsOf`, so one that does not fit the contract is left out, never the answer.
 */
export async function careLane(context: PatientContext, lane: Lane, decision: Decision, said: string, language: Language): Promise<LaneAnswer | undefined> {
  const say = SAY[language];
  const answer = (a: LaneAnswer | undefined) => a && { ...a, cards: cardsOf(a.cards) };
  if (lane.intent === "book_appointment") return answer(await book(context, said, say, language));
  if (lane.intent === "next_appointment") return answer(await nextVisit(context, say, language));
  if (lane.intent === "log_dose") return answer(await dose(context, said, say, language));
  if (lane.intent === "log_reading") return answer(reading(decision, said, say));
  return undefined;
}

/** The doctors her words find (the care team when they find none), up to 3, and a request drafted for the first one's first free time. */
async function book(context: PatientContext, said: string, say: (typeof SAY)[Language], language: Language): Promise<LaneAnswer | undefined> {
  const found = await doctorsFor(context, said);
  const shown = (found.length ? found : (await doctorsFor(context)).filter(d => d.careTeam)).slice(0, 3);
  const first = shown.find(d => d.nextSlots.length), at = first?.nextSlots[0]?.times[0];
  if (!first || !at) return undefined;
  const when = whenOf(at, language);
  return {
    answer: say.book(`${first.name} (${first.specialty})`, when), grounded: true, from: "visits", marks: [{ text: when, kind: "dose" }],
    cards: [
      ...shown.map(d => ({ type: "doctor" as const, id: d.id, name: d.name, specialty: d.specialty, room: d.room, rating: d.rating, careTeam: d.careTeam })),
      { type: "action", do: "book", title: `${shortName(first.name)}, ${when}`, items: [first.specialty, first.room], ...say.booking,
        payload: { doctorId: first.id, startsAt: at.toISOString(), reason: said.trim().slice(0, 200) } },
    ],
  };
}

/** Her coming visits (as her Schedule shows them, with the doctor's room when it has one) and the times she asked for. */
async function nextVisit(context: PatientContext, say: (typeof SAY)[Language], language: Language): Promise<LaneAnswer> {
  const { db, hospitalId, patientId } = context, now = clockOf(context);
  const [visits, asked] = await Promise.all([
    followUpsOf(context, language),
    db.select({ doctor: doctors.name, specialty: doctors.specialty, room: doctors.room, at: bookingRequests.startsAt }).from(bookingRequests).innerJoin(doctors, eq(doctors.id, bookingRequests.doctorId))
      .where(and(eq(bookingRequests.hospitalId, hospitalId), eq(bookingRequests.patientId, patientId), eq(bookingRequests.status, "requested"), gte(bookingRequests.startsAt, now)))
      .orderBy(asc(bookingRequests.startsAt)),
  ]);
  const coming = visits.filter(v => v.status === "upcoming" || v.status === "due-soon");
  const rooms = coming.length ? new Map((await db.select({ id: appointments.id, room: doctors.room }).from(appointments).innerJoin(doctors, eq(doctors.id, appointments.doctorId))
    .where(inArray(appointments.id, coming.map(v => v.id)))).map(r => [r.id, r.room])) : new Map<string, string>();
  const cards: AnswerCard[] = [
    ...coming.map(v => ({ type: "appointment" as const, title: v.title, when: v.date.toISOString(), ...rooms.has(v.id) && { where: rooms.get(v.id)! }, status: v.status })),
    ...asked.map(r => ({ type: "appointment" as const, title: `${shortName(r.doctor)}, ${r.specialty}`, when: r.at.toISOString(), where: r.room, status: "requested" as const })),
  ].slice(0, 3);
  const next = coming[0];
  if (!next) return { answer: say.noVisit, grounded: true, from: "visits", marks: [], cards };
  // A recall or the discharge review has a day, not a time (visitsText says the same).
  const when = whenOf(next.date, language, next.id.startsWith("recall:") || next.id === "discharge-review");
  return { answer: say.next(next.title, when, rooms.get(next.id)), grounded: true, from: "visits", marks: [{ text: when, kind: "dose" }], cards };
}

/**
 * The dose she means: of her take-home medicines, the not-yet-marked doses from MISSED_AFTER ago to EARLY_MS ahead, of
 * the one medicine she names, or of the only medicine with one open; the nearest to now. Two medicines open and none named
 * (or one still in hospital, with no take-home plan) is not sure, so Gemma answers.
 */
async function dose(context: PatientContext, said: string, say: (typeof SAY)[Language], language: Language): Promise<LaneAnswer | undefined> {
  const { db, hospitalId, patientId } = context, now = clockOf(context).getTime();
  // Her take-home schedule as doseScheduleOf reads it, in her language for the card.
  const [home, plan, keys] = await Promise.all([lastDischarge(db, hospitalId, patientId), planOf(db, hospitalId, patientId), takenKeys(db, hospitalId, patientId)]);
  if (!home) return undefined;
  const m = patientMeds(plan, language), taken = new Set(keys), out = new Date(home.dischargedAt), words = said.toLowerCase();
  const open = [...m.new, ...m.changed, ...m.continue].flatMap(med => doseSlots(med, out, new Date(now + EARLY_MS))
    .filter(at => !taken.has(doseKey(med.name, at)) && now - at.getTime() < MISSED_AFTER).map(at => ({ med, at })));
  const named = open.filter(d => words.includes(d.med.name.toLowerCase().split(" ")[0]!));
  const pool = named.length ? named : open;
  if (new Set(pool.map(d => d.med.name)).size !== 1) return undefined;
  const { med, at } = pool.sort((a, b) => Math.abs(a.at.getTime() - now) - Math.abs(b.at.getTime() - now))[0]!;
  const when = whenOf(at, language);
  return {
    answer: say.dose(med.name, when), grounded: true, from: "doses", marks: [{ text: med.name, kind: "medicine" }, { text: when, kind: "dose" }],
    cards: [
      { type: "medicine", name: med.name, ...med.take && { how: med.take }, ...med.at?.length && { times: med.at }, source: say.plan },
      { type: "action", do: "logDose", title: med.name, items: [when], ...say.dosing, payload: { key: doseKey(med.name, at) } },
    ],
  };
}

/**
 * The reading she gave, drafted to save: Clef's pick of which reading, and its numbers only when they are plain (one, or
 * two for a blood pressure, upper first, each in range); anything else (a time beside it, a number in words) Gemma answers.
 * ponytail: digits only; a spoken "one thirty eight over eighty six" goes to Gemma until number words are read.
 */
function reading(decision: Decision, said: string, say: (typeof SAY)[Language]): LaneAnswer | undefined {
  const kind = decision.picks.reading as Kind | undefined;
  if (!kind || !(kind in READING_KINDS)) return undefined;
  const { unit, min, max } = READING_KINDS[kind], bp = kind === "blood_pressure";
  const numbers = (said.match(/\d+(?:\.\d+)?/g) ?? []).map(Number), [value, value2] = numbers as [number, number | undefined];
  if (numbers.length !== (bp ? 2 : 1) || value < min || value > max || (bp && !(value2! >= 30 && value2! < value))) return undefined;
  const shown = `${say.kinds[kind]} ${bp ? `${value}/${value2}` : value} ${unit}`;
  return {
    answer: say.reading(shown), grounded: true, marks: [{ text: shown, kind: "test" }],
    cards: [{ type: "action", do: "logReading", title: shown, ...say.saving, payload: { kind, value, ...bp && { value2 } } }],
  };
}

// --- Sona Pro's lane answers ----------------------------------------------------------------------------------------

type Clinician = Context & { hospitalId: string; role: Role };
/** Who a task is for, by Clef's pick; "self" is the asking clinician by name. */
const OWNERS: Record<string, string> = { house_officer: "House officer", nurse: "Ward nurse", night_team: "Night team", other: "Treating clinician" };
const MYT = 8 * 3600_000, DAY = 86_400_000;

/**
 * Sona Pro's answer to a lane turn, as ask.free answers (an ask-catalogue spec, by the rules: the words are the page's
 * own or the doctor's): the ward's list (the web's rule answers, webPage) or a task drafted from the doctor's words for
 * the open visit, as an action card the doctor confirms (tasks.create). None for a task with no visit open.
 */
export async function proLane(context: Clinician, lane: Lane, decision: Decision, question: string, encounterId?: string) {
  if (lane.intent === "ward_overview") return { source: "rules" as const, spec: (await webPage(context)).specs[ruleFor(question) ?? "needs"], lane };
  if (lane.intent !== "create_task" || !encounterId) return undefined;
  const words = question.trim().replace(/[.!?。]+$/, ""), title = (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 200);
  const pick = decision.picks.owner, owner = (pick === "self" ? context.session?.user.name : OWNERS[pick ?? "other"]) || OWNERS.other!;
  const days = decision.picks.due === "today" ? 0 : decision.picks.due === "tomorrow" ? 1 : undefined;
  const due = days === undefined ? undefined : new Date(Math.floor((clockOf(context).getTime() + MYT) / DAY + days) * DAY).toISOString().slice(0, 10);
  const lead = `Task for ${owner}${days === undefined ? "" : `, due ${days ? "tomorrow" : "today"}`}: ${title}.`;
  const spec = checkAskSpec({ root: "t", elements: { t: { type: "AskColumn", props: {}, children: ["t-0"] }, "t-0": { type: "AskLead", props: { text: lead.slice(0, 280) }, children: [] } } });
  const cards = cardsOf([{
    type: "action", do: "createTask", title, items: [`Owner: ${owner}`, ...due ? [`Due: ${due}`] : []],
    what: "Adds it to this visit's tasks.", confirm: "Add task", done: "Added to Tasks.", payload: { encounterId, title, owner, ...due && { due } },
  }]);
  return spec && cards.length ? { source: "rules" as const, spec, cards, lane } : undefined;
}
