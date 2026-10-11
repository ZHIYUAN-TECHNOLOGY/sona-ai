import { LANE_INTENTS, cardsOf, type AnswerCard, type Lane, type Mark } from "@sona-ai/domain/answer-parts";
import { patientMeds } from "@sona-ai/domain/care";
import type { Language } from "@sona-ai/domain/discharge";
import { shortName } from "@sona-ai/domain/doctors";
import { MISSED_AFTER, doseKey, doseSlots } from "@sona-ai/domain/doses";

import { comingVisits, readingLabel, visitCard } from "./answer-cards";
import { ruleFor, webPage, type WebPage } from "./ask-context";
import { checkAskSpec } from "./ask-spec";
import { clockOf, type Context } from "./context";
import { PASSAGES_MS } from "./leaflets";
import { can, type Role } from "./roles";
import { doctorsFor } from "./routers/bookings";
import { lastDischarge, planOf, takenKeys } from "./routers/care-plan";
import { READING_KINDS } from "./routers/care-readings";
import type { WorkersAi } from "./workers-models";

/**
 * The Clef fast lane (docs/answer-parts.md). clef-omni on Workers AI reads what a patient or a doctor just said, beside
 * the usual answer: what they want, how sure it is, whether they also ask a question or call something off, and how
 * likely it is an emergency happening now. When it is sure of a lane turn, Sona answers it at once from the database
 * without Gemma (her next visit in Sona Care; a task or the ward's list in Sona Pro), or drafts its action under Gemma's
 * answer (a booking, a dose or a reading in Sona Care, which may need Gemma's words); anything else Gemma answers as
 * before. Its emergency read always reaches the care team. It is never waited for: a turn takes its read only when it
 * is in before the turn's own reads are.
 * Approved for routing and triage only (Jay, 11 Oct: an exception to Malaysia-only), so it is sent the words and a fixed
 * line about the app, nothing from the record. Rules and numbers from the Clef trial (11 Oct, .scratch-eval/clef-trial).
 */
export const CLEF_MODEL = "@cf/cloudflare/clef-omni";
export type App = keyof typeof LANE_INTENTS;

/** Clef's read gives up after this long (as the leaflet search does): what the care team and a turn's end wait for at most. */
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
    // "change or move" (11 Oct review): a reschedule read as a new booking, 0.98 ("我想改一下复诊的时间"), and drafted a second visit.
    cancels: { type: "noul", instructions: "Does the message cancel, undo, change or move something already planned, put it off, or say wait or never mind?" },
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

// --- Sona Care's lane --------------------------------------------------------------------------------------------------

type PatientContext = Context & { hospitalId: string; patientId: string };
/** Sona Care's answer to a next-visit turn: Sona's own line in her language, the words to colour in it, and her visits as cards. */
export type LaneAnswer = { answer: string; grounded: boolean; from: string; marks: Mark[]; cards: AnswerCard[] };
type Draft = { what: string; confirm: string; done: string };
type Kind = keyof typeof READING_KINDS;

/** Sona's lane lines, worded as Sona Care's app words them (the Doctors tab, her care team). */
const SAY: Record<Language, { next(title: string, when: string, where?: string): string; noVisit: string; booking: Draft; dosing: Draft; saving: Draft }> = {
  en: {
    next: (title, when, where) => `Your next visit is ${title}, ${when}${where ? `, at ${where}` : ""}.`,
    noVisit: "You have no visit booked. To book one, pick a doctor and a time on Doctors.",
    booking: { what: "Your care team confirms the time and lets you know.", confirm: "Request this time", done: "Requested. Your care team will confirm it." },
    dosing: { what: "Marks this dose taken, so your care team sees it.", confirm: "Mark taken", done: "Marked as taken." },
    saving: { what: "Saves it to your readings, so your care team sees it.", confirm: "Save reading", done: "Saved to your readings." },
  },
  ms: {
    next: (title, when, where) => `Lawatan anda yang seterusnya: ${title}, ${when}${where ? `, di ${where}` : ""}.`,
    noVisit: "Anda belum ada lawatan. Untuk menempah, pilih doktor dan masa di Doktor.",
    booking: { what: "Pasukan penjagaan anda mengesahkan masa dan memaklumkan anda.", confirm: "Minta masa ini", done: "Sudah diminta. Pasukan penjagaan anda akan mengesahkannya." },
    dosing: { what: "Tanda dos ini sudah diambil, supaya pasukan penjagaan anda nampak.", confirm: "Tanda sudah ambil", done: "Sudah ditanda diambil." },
    saving: { what: "Simpan dalam bacaan anda, supaya pasukan penjagaan anda nampak.", confirm: "Simpan bacaan", done: "Sudah disimpan dalam bacaan anda." },
  },
  zh: {
    next: (title, when, where) => `您的下一次预约：${title}，${when}${where ? `，地点：${where}` : ""}。`,
    noVisit: "您还没有预约。要预约，请在“医生”页选择医生和时间。",
    booking: { what: "护理团队会确认时间并通知您。", confirm: "申请这个时间", done: "已申请，护理团队会确认。" },
    dosing: { what: "标记这一剂已服用，护理团队可以看到。", confirm: "标记已服用", done: "已标记为已服用。" },
    saving: { what: "保存到您的测量记录，护理团队可以看到。", confirm: "保存读数", done: "已保存到您的测量记录。" },
  },
};

const LOCALE: Record<Language, string> = { en: "en-GB", ms: "ms-MY", zh: "zh-CN" };
/** A day and time as she reads them, in Malaysia time ("Thu 15 Oct, 10:30"); `day` alone for a visit with no set time. */
const whenOf = (at: Date, language: Language, day = false) =>
  at.toLocaleString(LOCALE[language], { weekday: "short", day: "numeric", month: "short", ...!day && { hour: "2-digit", minute: "2-digit", hour12: false }, timeZone: "Asia/Kuala_Lumpur" });

/** A dose may be marked from this long before it is due (she took it a little early). */
const EARLY_MS = 3600_000;

/**
 * The one lane turn Sona Care answers without Gemma: when her next visit is, from her visits as her Schedule shows them
 * (comingVisits, the same list an answer's visit cards come from), with the times she asked for as cards beside it.
 */
export async function nextVisit(context: PatientContext, language: Language): Promise<LaneAnswer> {
  const say = SAY[language], visits = await comingVisits(context, language), next = visits.find(v => v.status !== "requested");
  const cards = cardsOf(visits.slice(0, 3).map(visitCard));
  if (!next) return { answer: say.noVisit, grounded: true, from: "visits", marks: [], cards };
  const when = whenOf(next.date, language, next.day);
  return { answer: say.next(next.title, when, next.where), grounded: true, from: "visits", marks: [{ text: when, kind: "dose" }], cards };
}

/**
 * What a booking, dose or reading turn Clef is sure of drafts for her to confirm, under Gemma's answer and never in
 * place of it (a sugar of 2.1 or four paracetamol needs Gemma's words): a request for the first free time with the doctor
 * her words find, the open dose of the medicine she names, or the reading she gave. None when nothing is sure, and none
 * passes `cardsOf` that does not fit the contract.
 */
export async function careDraft(context: PatientContext, lane: Lane, decision: Decision, said: string, language: Language): Promise<AnswerCard | undefined> {
  const say = SAY[language];
  const draft = lane.intent === "book_appointment" ? await book(context, said, say.booking, language)
    : lane.intent === "log_dose" ? await dose(context, said, say.dosing, language)
    : lane.intent === "log_reading" ? reading(decision, said, say.saving, language) : undefined;
  return cardsOf([draft])[0];
}

/** A request for the first free time of the first doctor her words find (her care team when they find none) who has one. */
async function book(context: PatientContext, said: string, booking: Draft, language: Language): Promise<AnswerCard | undefined> {
  const found = await doctorsFor(context, said);
  const first = (found.length ? found : (await doctorsFor(context)).filter(d => d.careTeam)).slice(0, 3).find(d => d.nextSlots.length), at = first?.nextSlots[0]?.times[0];
  if (!first || !at) return undefined;
  return { type: "action", do: "book", title: `${shortName(first.name)}, ${whenOf(at, language)}`, items: [first.specialty, first.room], ...booking,
    payload: { doctorId: first.id, startsAt: at.toISOString(), reason: said.trim().slice(0, 200) } };
}

/**
 * The dose she means: of her take-home medicines, the not-yet-marked doses from MISSED_AFTER ago to EARLY_MS ahead of
 * the one medicine she names, the nearest to now. One she does not name is never guessed: "my paracetamol" while only
 * her antibiotic is open would mark the antibiotic taken. None named, two named, or still in hospital: no draft.
 */
async function dose(context: PatientContext, said: string, dosing: Draft, language: Language): Promise<AnswerCard | undefined> {
  const { db, hospitalId, patientId } = context, now = clockOf(context).getTime();
  const [home, plan, keys] = await Promise.all([lastDischarge(db, hospitalId, patientId), planOf(db, hospitalId, patientId), takenKeys(db, hospitalId, patientId)]);
  if (!home) return undefined;
  const m = patientMeds(plan, language), taken = new Set(keys), out = new Date(home.dischargedAt), words = said.toLowerCase();
  const named = [...m.new, ...m.changed, ...m.continue].filter(med => words.includes(med.name.toLowerCase().split(" ")[0]!)).flatMap(med => doseSlots(med, out, new Date(now + EARLY_MS))
    .filter(at => !taken.has(doseKey(med.name, at)) && now - at.getTime() < MISSED_AFTER).map(at => ({ med, at })));
  if (new Set(named.map(d => d.med.name)).size !== 1) return undefined;
  const { med, at } = named.sort((a, b) => Math.abs(a.at.getTime() - now) - Math.abs(b.at.getTime() - now))[0]!;
  return { type: "action", do: "logDose", title: med.name, items: [whenOf(at, language)], ...dosing, payload: { key: doseKey(med.name, at) } };
}

/**
 * The reading she gave, drafted to save: Clef's pick of which reading, and its numbers only when they are plain (one, or
 * two for a blood pressure, upper first, each in range); anything else (a time beside it, a number in words) drafts nothing.
 * ponytail: digits only; a spoken "one thirty eight over eighty six" drafts nothing until number words are read.
 */
function reading(decision: Decision, said: string, saving: Draft, language: Language): AnswerCard | undefined {
  const kind = decision.picks.reading as Kind | undefined;
  if (!kind || !(kind in READING_KINDS)) return undefined;
  const { unit, min, max } = READING_KINDS[kind], bp = kind === "blood_pressure";
  const numbers = (said.match(/\d+(?:\.\d+)?/g) ?? []).map(Number), [value, value2] = numbers as [number, number | undefined];
  if (numbers.length !== (bp ? 2 : 1) || value < min || value > max || (bp && !(value2! >= 30 && value2! < value))) return undefined;
  return { type: "action", do: "logReading", title: `${readingLabel(kind, language)} ${bp ? `${value}/${value2}` : value} ${unit}`, ...saving, payload: { kind, value, ...bp && { value2 } } };
}

// --- Sona Pro's lane answers ----------------------------------------------------------------------------------------

type Clinician = Context & { hospitalId: string; role: Role };
/** Who a task is for, by Clef's pick; "self" is the asking clinician by name. */
const OWNERS: Record<string, string> = { house_officer: "House officer", nurse: "Ward nurse", night_team: "Night team", other: "Treating clinician" };
const MYT = 8 * 3600_000, DAY = 86_400_000;

/**
 * Sona Pro's answer to a lane turn, as ask.free answers (an ask-catalogue spec, by the rules: the words are the page's
 * own or the doctor's): the ward's list (the web's rule answers, from `page` when ask.free has already read it) or a task
 * drafted from the doctor's words for the open visit, as an action card the doctor confirms (tasks.create). A task is
 * drafted only for an app that shows the card (`drafts`: an older Sona Pro shows the words alone, with nothing to
 * confirm them by), on an open visit, for a role that may add one; otherwise none, and Gemma answers.
 */
export async function proLane(context: Clinician, lane: Lane, decision: Decision, question: string, open: { encounterId?: string; drafts?: boolean; page?: WebPage } = {}) {
  if (lane.intent === "ward_overview") return { source: "rules" as const, spec: (open.page ?? await webPage(context)).specs[ruleFor(question) ?? "needs"], lane };
  const { encounterId } = open;
  if (lane.intent !== "create_task" || !encounterId || !open.drafts || !can(context.role, "tasks.create")) return undefined;
  const words = question.trim().replace(/[.!?。]+$/, ""), title = (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 200);
  const pick = decision.picks.owner, owner = (pick === "self" ? context.session?.user.name : OWNERS[pick ?? "other"]) || OWNERS.other!;
  const days = decision.picks.due === "today" ? 0 : decision.picks.due === "tomorrow" ? 1 : undefined;
  const due = days === undefined ? undefined : new Date(Math.floor((clockOf(context).getTime() + MYT) / DAY + days) * DAY).toISOString().slice(0, 10);
  // Said as a draft: nothing is added until the doctor taps Add task.
  const lead = `Drafted, not added yet: a task for ${owner}${days === undefined ? "" : `, due ${days ? "tomorrow" : "today"}`}: ${title}.`;
  const spec = checkAskSpec({ root: "t", elements: { t: { type: "AskColumn", props: {}, children: ["t-0"] }, "t-0": { type: "AskLead", props: { text: lead.slice(0, 280) }, children: [] } } });
  const cards = cardsOf([{
    type: "action", do: "createTask", title, items: [`Owner: ${owner}`, ...due ? [`Due: ${due}`] : []],
    what: "Adds it to this visit's tasks.", confirm: "Add task", done: "Added to Tasks.", payload: { encounterId, title, owner, ...due && { due } },
  }]);
  return spec && cards.length ? { source: "rules" as const, spec, cards, lane } : undefined;
}
