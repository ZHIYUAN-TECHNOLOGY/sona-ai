import { ORPCError } from "@orpc/server";
import { DEMO_PATIENT_PHONE, DEMO_SIGN_IN_CODE } from "@sona-ai/db/demo";
import { careCodes, careLinks, encounters, hospitalMembers, hospitals, patients } from "@sona-ai/db/schema/clinical";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { clockOf, type Context } from "../context";
import { patientProcedure, protectedProcedure, publicProcedure, signedInProcedure } from "../index";
import { checkInReplySchema, xrayUploadSchema } from "../contracts";
import { listCheckIns, replyToCheckIn } from "./check-ins";
import { clockOffsetOf } from "../clock";
import { languageOf } from "@sona-ai/domain/language";
import type { AnswerCard } from "@sona-ai/domain/answer-parts";
import type { Language } from "@sona-ai/domain/discharge";
import { cardsFor, careCards } from "../answer-cards";
import { BRAIN_MODEL, answered, boxes, wakingOf, type Baseten } from "../baseten-models";
import { JSON_REPLY, streamingAnswer, type ChatDeltas } from "../chat-models";
import { citedSources, leafletHits, passagesIn } from "../leaflets";
import { stubModels, type Models } from "../models";
import { deltas } from "../sse";
import { recordText } from "./care-plan";
import { loadEncounter } from "./encounter";
import { careDosesRouter } from "./doses";
import { careMessagesRouter } from "./messages";
import { registerPushToken, unregisterPushToken } from "../push";
import { setTrainingConsent, trainingConsentOf } from "./training";
import { LINES, callNow } from "../voice-agent/answer";
import { tellCareTeam } from "../voice-agent/care-team";
import { CLEF_MODEL, EMERGENCY_AT, careDraft, decideTurn, laneOf, nextVisit, type Decision } from "../decide";

/**
 * Errors a patient can see carry a stable `data.code` (CODE_UNKNOWN, SPEECH_OFF, …) so Sona Care can
 * say them in the patient's language; the English message stays as the fallback.
 *
 * Sona Care, the patient app. A doctor issues a one-time code for a visit (printed as a QR on the
 * discharge paper); the patient previews it, signs up, and redeems it, which links their account
 * to that patient record only. Codes use an alphabet without look-alikes (no 0/O, 1/I/L).
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_DAYS = 14;
const firstName = (name: string) => name.split(" ")[0]!;

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map(b => ALPHABET[b % ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}
/** Accepts the code however it was typed: lower case, with or without the dash or spaces. */
const normalise = (code: string) => { const c = code.toUpperCase().replace(/[^A-Z0-9]/g, ""); return `${c.slice(0, 4)}-${c.slice(4, 8)}`; };
const codeInput = z.object({ code: z.string().trim().min(8).max(20) });
/** The QR's link: Sona Care web on the Worker's own address, so any phone camera opens it; the app's scanner reads `code=` from it too. */
export const joinLink = (code: string, publicUrl?: string) => publicUrl ? `${publicUrl.replace(/\/$/, "")}/care/join?code=${code}` : `sona-care://join?code=${code}`;

async function codeRow(db: Context["db"], code: string) {
  const [row] = await db.select({ code: careCodes, patient: patients.name, hospital: hospitals.name }).from(careCodes)
    .innerJoin(patients, eq(patients.id, careCodes.patientId)).innerJoin(hospitals, eq(hospitals.id, careCodes.hospitalId))
    .where(eq(careCodes.code, normalise(code)));
  if (!row) throw new ORPCError("NOT_FOUND", { message: "That code was not recognised. Check it against your discharge paper.", data: { code: "CODE_UNKNOWN" } });
  return row;
}

// About 40 seconds of 16 kHz mono WAV, base64: a spoken question or reply, not a recording session.
export const MAX_AUDIO_BASE64 = 1_800_000;
// A sentence or two of an answer: Sona's voice takes longer to make than to hear, so the app sends one part at a time.
export const MAX_SPOKEN = 300;
const TOLD = Object.values(LINES).map(l => l.told);

const askInput = z.object({ question: z.string().trim().min(2).max(2000), history: z.array(z.object({ question: z.string().trim().min(1).max(2000), answer: z.string().trim().max(4000) })).max(6).optional() });
type PatientContext = Context & { hospitalId: string; patientId: string };
type Asked = Parameters<Models["answerFromPlan"]>[0];

/**
 * What care.askStream sends before the answer, each as soon as it is known: the 999 card (`call999`; sent again, with her
 * plan's warning signs, once her record is read), the card the lane drafted with a line over it (`lane`), and Gemma's
 * words (`words`: put `text` in place of what was sent from `at` on; a retry starts again at 0).
 */
export type AskPart = { type: "call999"; card: AnswerCard } | { type: "lane"; card: AnswerCard; lead?: string } | { type: "words"; at: number; text: string };

/** The line over a card the lane drafted, while Gemma writes, in the question's language (Sona's own words: decide.ts SAY). */
const LEAD: Record<Language, Partial<Record<string, string>>> = {
  en: { book: "Here is a time you can request.", logDose: "Here is the dose to mark as taken.", logReading: "Here is your reading, ready to save." },
  ms: { book: "Ini masa yang boleh anda minta.", logDose: "Ini dos untuk ditanda sudah diambil.", logReading: "Ini bacaan anda, sedia untuk disimpan." },
  zh: { book: "这是您可以申请的时间。", logDose: "这是可以标记为已服用的一剂。", logReading: "这是您的读数，可以保存。" },
};

/**
 * Gemma's answer from box ① as she writes it (chat-models streamingAnswer: her prompt, retries and reading as care.ask's,
 * box ① asked as basetenModels asks it, streamed): `parts` sends each change of her words, as fast as they are read;
 * `done` is her whole answer, as care.ask's model gives it (a box that is starting answers the stub, with `waking`).
 */
function written(baseten: Baseten, input: Asked) {
  const { send } = boxes(baseten);
  const stream: ChatDeltas = async (system, user, maxTokens = 1000) => {
    const body = JSON.stringify({ model: BRAIN_MODEL, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.1, max_tokens: maxTokens, response_format: JSON_REPLY, stream: true });
    return deltas((await send("brain", "/v1/chat/completions", body, "application/json")).body!, () => answered("brain"));
  };
  let words = "", ping = () => {};
  const done = streamingAnswer(stream, BRAIN_MODEL, stubModels, soFar => { words = soFar; ping(); })(input)
    .then(answer => answer.source === "fixture" ? { ...answer, ...wakingOf("brain") } : answer);
  async function* parts(): AsyncGenerator<AskPart> {
    for (let sent = "", over = false; !over;) {
      if (words === sent) over = await Promise.race([done.then(() => true), new Promise<false>(resolve => { ping = () => resolve(false); })]);
      // The words as they stand now: more may come while this part waits to be read.
      const now = words;
      if (now === sent) continue;
      let at = 0;
      while (at < sent.length && sent[at] === now[at]) at++;
      yield { type: "words", at, text: now.slice(at) };
      sent = now;
    }
  }
  return { parts: parts(), done };
}

/**
 * One answer to her question: care.ask's (below), and care.askStream's parts before it as they are known. The 999 card
 * waits for nothing; the lane's drafted card and the 999 card Clef's emergency read brings come before Gemma's first
 * word, so nothing above her words moves once they start; then her words as she writes them (`brain`: box ① streamed;
 * without it they come with the answer). care.ask passes no `brain` and reads only the answer, as it always has.
 */
async function* answering(context: PatientContext, input: z.infer<typeof askInput>, brain?: Baseten) {
  // The question's own language (an English question gets English, even when her papers are in Malay).
  const language = languageOf(input.question), floor = callNow(input.question);
  if (floor) yield { type: "call999", card: cardsFor({ urgent: true }, { named: [] }, language)[0]! } as AskPart;
  // The hospital's leaflets for the question are searched while her record is read. The search never fails the answer
  // and is given PASSAGES_MS from here; a part of her record that cannot be read never fails it either (recordText).
  // Her visits and her record are real whether or not she has gone home; only the take-home plan waits for discharge.
  const reads = Promise.all([recordText(context), leafletHits(context.library, context.hospitalId, input.question)]);
  // Clef's read beside them (none while CLEF_LANE is off), at most DECIDE_MS.
  let decision: Decision | undefined;
  const deciding = decideTurn(context.clef, { app: "care", said: input.question }).then(d => { decision = d; });
  const raised = () => (decision?.emergency ?? 0) >= EMERGENCY_AT;
  // A real emergency only: the 999 keyword floor, Clef's emergency read, or the model's own urgent flag, one task for all.
  // Clef's read is urgent whatever the care team's reader says (nothing cancels an escalation); the floor's is the reader's
  // call. The floor's task waits for Clef's read (at once while it is off), so one task carries both. Never fails the answer.
  let told: ReturnType<typeof tellCareTeam> | undefined;
  const tell = () => told ??= tellCareTeam(context, context.hospitalId, context.patientId, input.question, raised() ? CLEF_MODEL : undefined)
    .catch(error => { console.error("care team not told", error); return undefined; });
  const escalating = deciding.then(() => floor || raised() ? tell() : undefined);
  // Kept alive past the answer: a patient shown the 999 card may close the app before a stream ends.
  context.waitUntil?.(escalating);
  // A booking, dose or reading Clef is sure of is drafted beside Gemma's answer, never in its place.
  const drafting = deciding.then(() => {
    const lane = laneOf(decision, "care", input.question, floor);
    return lane && lane.intent !== "next_appointment" ? careDraft(context, lane, decision!, input.question, language).catch(error => { console.error("lane not drafted", error); return undefined; }) : undefined;
  });
  await Promise.race([reads, deciding]);
  const lane = laneOf(decision, "care", input.question, floor);
  if (lane?.intent === "next_appointment") {
    const visit = await nextVisit(context, language).catch(error => { console.error("lane not answered", error); return undefined; });
    if (visit) return { ...visit, urgent: false, source: "model" as const, model: CLEF_MODEL, withheld: 0, sources: [], lane };
  }
  const [{ plan, text: record }, hits] = await reads;
  const passages = passagesIn(hits, language);
  // Sona's told line is Sona's, said once a task exists: kept out of what the model reads back, so it never echoes it.
  const history = input.history?.map(t => ({ ...t, answer: TOLD.reduce((a, line) => a.split(line).join(""), t.answer).trim() }));
  const asked: Asked = { question: input.question, plan: record, language, passages, history };
  let read: Awaited<ReturnType<Models["answerFromPlan"]>>;
  if (brain) {
    const words = written(brain, asked);
    // Gemma is writing; what goes above her words first. Clef is in by now, or within DECIDE_MS.
    const draft = await drafting;
    if (floor || raised()) {
      const [sos] = await careCards(context, { plan, urgent: true, language }).catch(() => []);
      if (sos) yield { type: "call999", card: sos } as AskPart;
    }
    if (draft) yield { type: "lane", card: draft, lead: draft.type === "action" ? LEAD[language][draft.do] : undefined } as AskPart;
    yield* words.parts;
    read = await words.done;
  } else read = await (context.models ?? stubModels).answerFromPlan(asked);
  const { cites, ...answer } = read;
  await deciding; // long since in (DECIDE_MS at most), unless the model answered at once
  const careTeam = await (told ?? (answer.urgent ? tell() : undefined));
  // Only a leaflet that was offered can be a source: a number Gemma made up names nothing.
  const sources = citedSources(cites, passages);
  // Cards from her own rows for what the model's answer names (../answer-cards), the 999 card first on any emergency, then
  // the lane's draft unless Gemma read it urgent; a card that cannot be read never fails the answer.
  const draft = answer.urgent ? undefined : await drafting;
  const cards = [...answer.source === "model" ? await careCards(context, { plan, ...answer, urgent: floor || answer.urgent || raised(), language }).catch(() => []) : [], ...draft ? [draft] : []];
  return { ...answer, withheld: 0, sources, ...careTeam && { careTeam: { ...careTeam, line: LINES[language].told } }, ...cards.length > 0 && { cards } };
}

export const careRouter = {
  /** Clinician: the visit's code and link for the QR, issued once per visit (reissued only once it has expired). */
  code: protectedProcedure.input(z.object({ encounterId: z.string().min(1) })).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    await loadEncounter(db, hospitalId, input.encounterId);
    const now = clockOf(context);
    const [existing] = await db.select().from(careCodes).where(eq(careCodes.encounterId, input.encounterId));
    if (existing && (existing.redeemedBy || existing.expiresAt > now)) return { code: existing.code, link: joinLink(existing.code, context.publicUrl), expiresAt: existing.expiresAt, joined: Boolean(existing.redeemedBy) };
    const [visit] = await db.select({ patientId: encounters.patientId }).from(encounters).where(eq(encounters.id, input.encounterId));
    const row = { code: newCode(), hospitalId, patientId: visit!.patientId, encounterId: input.encounterId, expiresAt: new Date(now.getTime() + CODE_DAYS * 24 * 3600_000) };
    await db.insert(careCodes).values(row).onConflictDoUpdate({ target: careCodes.encounterId, set: { code: row.code, expiresAt: row.expiresAt, redeemedBy: null, redeemedAt: null } });
    return { code: row.code, link: joinLink(row.code, context.publicUrl), expiresAt: row.expiresAt, joined: false };
  }),

  /** Anyone: who a code is for, first name only, so the patient can confirm before signing up. */
  preview: publicProcedure.input(codeInput).handler(async ({ context, input }) => {
    const row = await codeRow(context.db, input.code);
    return { firstName: firstName(row.patient), hospital: row.hospital };
  }),

  /**
   * Anyone: on staging with DEMO_SIGN_IN=1, the seeded synthetic demo phone and its fixed code, so the
   * sign-in screen can show them ("Demo code: 123456"); null everywhere else.
   */
  demoSignIn: publicProcedure.handler(({ context }) => context.demoSignIn ? { phone: DEMO_PATIENT_PHONE, code: DEMO_SIGN_IN_CODE } : null),

  /** A signed-in account redeems a code once; a clinician account cannot become a patient account. */
  join: signedInProcedure.input(codeInput).handler(async ({ context, input }) => {
    const { db } = context, userId = context.session.user.id;
    const row = await codeRow(db, input.code);
    const [member] = await db.select().from(hospitalMembers).where(eq(hospitalMembers.userId, userId));
    if (member) throw new ORPCError("FORBIDDEN", { message: "This is a clinician account. Create a separate account for Sona Care.", data: { code: "CLINICIAN_ACCOUNT" } });
    if (row.code.redeemedBy === userId) return { firstName: firstName(row.patient) };
    if (row.code.redeemedBy) throw new ORPCError("CONFLICT", { message: "This code has already been used. Ask the ward for a new one.", data: { code: "CODE_USED" } });
    if (row.code.expiresAt < clockOf(context)) throw new ORPCError("PRECONDITION_FAILED", { message: "This code has expired. Ask the ward for a new one.", data: { code: "CODE_EXPIRED" } });
    // One record per account: a new visit's code for the same patient redeems; another patient's would be a silent no-op.
    const [linked] = await db.select().from(careLinks).where(eq(careLinks.userId, userId));
    if (linked && linked.patientId !== row.code.patientId) throw new ORPCError("CONFLICT", { message: "This account is linked to another record. Use a separate account for this code.", data: { code: "OTHER_RECORD" } });
    await db.insert(careLinks).values({ userId, hospitalId: row.code.hospitalId, patientId: row.code.patientId }).onConflictDoNothing();
    await db.update(careCodes).set({ redeemedBy: userId, redeemedAt: clockOf(context) }).where(eq(careCodes.code, row.code.code));
    return { firstName: firstName(row.patient) };
  }),

  /** Patient: who they are and their visit. */
  me: patientProcedure.handler(async ({ context }) => {
    const [row] = await context.db.select({ patient: patients, hospital: hospitals.name, encounterId: encounters.id, state: encounters.state }).from(patients)
      .innerJoin(hospitals, eq(hospitals.id, patients.hospitalId)).leftJoin(encounters, eq(encounters.patientId, patients.id))
      .where(eq(patients.id, context.patientId));
    if (!row) throw new ORPCError("NOT_FOUND", { message: "Your record was not found", data: { code: "RECORD_MISSING" } });
    const dischargedAt = (row.state as { discharge?: { dischargedAt?: string } } | null)?.discharge?.dischargedAt;
    return { patientId: row.patient.id, name: row.patient.name, firstName: firstName(row.patient.name), hospital: row.hospital, encounterId: row.encounterId ?? undefined, dischargedAt };
  }),

  /**
   * Patient: their speech as text (Malay, English, Chinese or mixed), so they can speak a question or a
   * check-in reply instead of typing it; the app shows the words before sending. Audio is read and
   * dropped, never stored. Refused while no speech model is switched on (the stub has no ears).
   */
  transcribe: patientProcedure.input(z.object({ audio: z.string().min(16).max(MAX_AUDIO_BASE64), language: z.enum(["en", "ms", "zh"]).optional() }))
    .handler(async ({ context, input }) => {
      const heard = await (context.models ?? stubModels).transcribe({ audio: Uint8Array.from(atob(input.audio), c => c.charCodeAt(0)), language: input.language });
      if (heard.source === "fixture") throw new ORPCError("PRECONDITION_FAILED", {
        message: heard.waking ? `Speaking to Sona Care is starting (about ${heard.waking} min). Please type instead, or try again then.` : "Speaking to Sona Care isn't switched on yet. Please type instead.",
        data: { code: "SPEECH_OFF" },
      });
      return heard;
    }),

  /**
   * Patient: part of an answer in Sona's own voice (box ②), as base64 WAV for the app to play. No audio
   * (source "fixture", with `waking` while the voice is starting) means the app reads it in the phone's
   * voice instead. Nothing is stored.
   */
  speak: patientProcedure.input(z.object({ text: z.string().trim().min(1).max(MAX_SPOKEN) })).handler(async ({ context, input }) => {
    const said = await (context.models ?? stubModels).speak({ text: input.text });
    if (said.source === "model" && said.audio) return { audio: said.audio, source: said.source, model: said.model };
    return { source: "fixture" as const, waking: said.source === "fixture" ? said.waking : undefined };
  }),

  /**
   * Patient: any question, answered fully (founder, 9 Oct: no limit on what Sona says, no "ask your care team" default).
   * Their own care comes from their record (recordText: the discharge plan once they are home, their visits, and what the
   * hospital recorded about them: history, allergy, medicines, observations, results, the latest note, their check-in
   * replies and doses), anything else from general knowledge: `grounded` is the model's own word for which. `history` is
   * the chat's earlier turns, oldest first, so a follow-up ("How does it help?") is answered in their light. The stub
   * answers nothing (source "fixture") and the app keeps its authored plan answers. A question naming an emergency sign
   * (callNow), or one the model flags urgent, also reaches their care team: `careTeam` is the flagged task (the call's
   * `sona_care_team`) with Sona's line saying so (`line`, in the question's language), there only once a task is made.
   * General advice rests on the hospital's own patient leaflets when one fits (../leaflets): `sources` names the leaflets
   * the answer used, by title; empty when it used none, or none could be found in time. `withheld` is always 0 (the
   * answer is no longer filtered), kept so clients that read it still do.
   * The Clef fast lane (../decide) reads the question beside her record and the leaflet search, never waited for: an
   * emergency it reads also reaches the care team and brings the 999 card (in `cards`; `urgent` stays Gemma's, so no app
   * drops Gemma's words for it); her next visit, when Clef is sure of it before her record is read, is answered at once
   * from her visits, with `cards` and `lane`, and Gemma is not asked; a booking, dose or reading it is sure of is drafted
   * as an action card under Gemma's answer. Old apps read only the words.
   */
  ask: patientProcedure.input(askInput).handler(async ({ context, input }) => {
    const run = answering(context, input);
    for (;;) { const next = await run.next(); if (next.done) return next.value; }
  }),
  /**
   * Patient: the same answer as an event stream, so she sees something at once (`answering`): the 999 card, the lane's
   * drafted card with its line, Gemma's words as she writes them, then `answer`, exactly as care.ask gives it. Apps that
   * cannot read a stream, or reach a server without it, ask care.ask.
   */
  askStream: patientProcedure.input(askInput).handler(async function* ({ context, input }) {
    yield { type: "answer" as const, answer: yield* answering(context, input, context.baseten) };
  }),

  /**
   * Patient: a photo of a medicine box or letter read as one medicine, for them to check and send to
   * their care team. The photo is kept under the patient's own prefix (when storage is configured) so
   * the message can point at it; nothing joins their medicines until the care team confirms it.
   * No photo means the app's bundled sample box.
   */
  readMedicinePhoto: patientProcedure.input(z.object({ photo: xrayUploadSchema.pick({ contentType: true, dataBase64: true }).optional() })).handler(async ({ context, input }) => {
    const image = input.photo && Uint8Array.from(atob(input.photo.dataBase64), c => c.charCodeAt(0));
    let key: string | undefined;
    if (image && context.uploads) {
      key = `care-photos/${context.hospitalId}/${context.patientId}/${crypto.randomUUID()}.${input.photo!.contentType === "image/png" ? "png" : "jpg"}`;
      await context.uploads.put(key, image, { httpMetadata: { contentType: input.photo!.contentType } });
    }
    const reading = await (image ? context.models ?? stubModels : stubModels).readMedicinePhoto({ image, contentType: input.photo?.contentType });
    return { ...reading, key };
  }),

  /** Patient: the hospital's demo clock offset (0 is real time), so the app's "now" matches the server's. */
  clock: patientProcedure.handler(async ({ context }) => ({ offsetMs: await clockOffsetOf(context.db, context.hospitalId) })),

  /** Patient: doses they marked taken (hold to take), so the care team sees adherence. */
  doses: careDosesRouter,

  /** Patient: their own check-ins after discharge, each with their reply and how it was read. */
  checkIns: {
    list: patientProcedure.handler(({ context }) => listCheckIns(context.db, context.hospitalId, { patientId: context.patientId })),
    /** The same reading and flagging as the clinician's simulated reply, for their own check-in only. */
    reply: patientProcedure.input(checkInReplySchema).handler(({ context, input }) => replyToCheckIn(context, context.hospitalId, input, context.patientId)),
  },
  /** Patient: whether they help improve Sona Care with de-identified replies and notes (off until they switch it on). */
  trainingConsent: patientProcedure.handler(({ context }) => trainingConsentOf(context.db, context.hospitalId, context.patientId)),
  /** Patient: switch it on, or withdraw (samples not yet exported are withdrawn with it). */
  setTrainingConsent: patientProcedure.input(z.object({ consented: z.boolean() })).handler(async ({ context, input }) => {
    const consent = await setTrainingConsent(context, context.hospitalId, context.patientId, input.consented);
    // The middleware finds no topic in this route's name; management's Training screen hears it as a training change.
    await context.announce?.(context.hospitalId, { topic: "training", patientId: context.patientId }).catch(() => {});
    return consent;
  }),
  /** Patient: their thread with the care team. */
  messages: careMessagesRouter,
  /** Patient: this phone's Expo push token, so check-ins, bookings and replies reach it (see ../push). */
  push: {
    register: patientProcedure.input(z.object({ token: z.string().trim().min(1).max(200), platform: z.enum(["ios", "android"]) }))
      .handler(async ({ context, input }) => {
        await registerPushToken(context.db, { ...input, userId: context.session.user.id, hospitalId: context.hospitalId, patientId: context.patientId });
        return { registered: true };
      }),
    unregister: patientProcedure.input(z.object({ token: z.string().trim().min(1).max(200) }))
      .handler(async ({ context, input }) => { await unregisterPushToken(context.db, input.token, context.session.user.id); return { registered: false }; }),
  },
};
