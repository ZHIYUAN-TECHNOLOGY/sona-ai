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
import { stubModels } from "../models";
import { patientPlan, planText } from "./care-plan";
import { loadEncounter } from "./encounter";
import { careDosesRouter } from "./doses";
import { careMessagesRouter } from "./messages";
import { registerPushToken, unregisterPushToken } from "../push";
import { setTrainingConsent, trainingConsentOf } from "./training";

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
export const joinLink = (code: string) => `sona-care://join?code=${code}`;

async function codeRow(db: Context["db"], code: string) {
  const [row] = await db.select({ code: careCodes, patient: patients.name, hospital: hospitals.name }).from(careCodes)
    .innerJoin(patients, eq(patients.id, careCodes.patientId)).innerJoin(hospitals, eq(hospitals.id, careCodes.hospitalId))
    .where(eq(careCodes.code, normalise(code)));
  if (!row) throw new ORPCError("NOT_FOUND", { message: "That code was not recognised. Check it against your discharge paper.", data: { code: "CODE_UNKNOWN" } });
  return row;
}

// About 40 seconds of 16 kHz mono WAV, base64: a spoken question or reply, not a recording session.
export const MAX_AUDIO_BASE64 = 1_800_000;

export const careRouter = {
  /** Clinician: the visit's code and link for the QR, issued once per visit (reissued only once it has expired). */
  code: protectedProcedure.input(z.object({ encounterId: z.string().min(1) })).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    await loadEncounter(db, hospitalId, input.encounterId);
    const now = clockOf(context);
    const [existing] = await db.select().from(careCodes).where(eq(careCodes.encounterId, input.encounterId));
    if (existing && (existing.redeemedBy || existing.expiresAt > now)) return { code: existing.code, link: joinLink(existing.code), expiresAt: existing.expiresAt, joined: Boolean(existing.redeemedBy) };
    const [visit] = await db.select({ patientId: encounters.patientId }).from(encounters).where(eq(encounters.id, input.encounterId));
    const row = { code: newCode(), hospitalId, patientId: visit!.patientId, encounterId: input.encounterId, expiresAt: new Date(now.getTime() + CODE_DAYS * 24 * 3600_000) };
    await db.insert(careCodes).values(row).onConflictDoUpdate({ target: careCodes.encounterId, set: { code: row.code, expiresAt: row.expiresAt, redeemedBy: null, redeemedAt: null } });
    return { code: row.code, link: joinLink(row.code), expiresAt: row.expiresAt, joined: false };
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
   * Patient: a question answered from their own discharge plan only. `grounded` false means the plan
   * does not say, so the app offers their care team; the stub answers nothing (source "fixture") and
   * the app keeps its authored plan answers.
   */
  ask: patientProcedure.input(z.object({ question: z.string().trim().min(2).max(500) })).handler(async ({ context, input }) => {
    const plan = await patientPlan(context);
    if (plan.status !== "discharged") return { answer: "", grounded: false, urgent: false, source: "fixture" as const };
    return (context.models ?? stubModels).answerFromPlan({ question: input.question, plan: planText(plan), language: plan.language });
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
  setTrainingConsent: patientProcedure.input(z.object({ consented: z.boolean() }))
    .handler(({ context, input }) => setTrainingConsent(context, context.hospitalId, context.patientId, input.consented)),
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
