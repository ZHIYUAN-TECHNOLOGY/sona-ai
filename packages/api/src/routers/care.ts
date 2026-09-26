import { ORPCError } from "@orpc/server";
import { careCodes, careLinks, encounters, hospitalMembers, hospitals, patients } from "@sona-ai/db/schema/clinical";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { clockOf, type Context } from "../context";
import { patientProcedure, protectedProcedure, publicProcedure, signedInProcedure } from "../index";
import { loadEncounter } from "./encounter";

/**
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
  if (!row) throw new ORPCError("NOT_FOUND", { message: "That code was not recognised. Check it against your discharge paper." });
  return row;
}

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

  /** A signed-in account redeems a code once; a clinician account cannot become a patient account. */
  join: signedInProcedure.input(codeInput).handler(async ({ context, input }) => {
    const { db } = context, userId = context.session.user.id;
    const row = await codeRow(db, input.code);
    const [member] = await db.select().from(hospitalMembers).where(eq(hospitalMembers.userId, userId));
    if (member) throw new ORPCError("FORBIDDEN", { message: "This is a clinician account. Create a separate account for Sona Care." });
    if (row.code.redeemedBy === userId) return { firstName: firstName(row.patient) };
    if (row.code.redeemedBy) throw new ORPCError("CONFLICT", { message: "This code has already been used. Ask the ward for a new one." });
    if (row.code.expiresAt < clockOf(context)) throw new ORPCError("PRECONDITION_FAILED", { message: "This code has expired. Ask the ward for a new one." });
    await db.insert(careLinks).values({ userId, hospitalId: row.code.hospitalId, patientId: row.code.patientId }).onConflictDoNothing();
    await db.update(careCodes).set({ redeemedBy: userId, redeemedAt: clockOf(context) }).where(eq(careCodes.code, row.code.code));
    return { firstName: firstName(row.patient) };
  }),

  /** Patient: who they are and their visit. */
  me: patientProcedure.handler(async ({ context }) => {
    const [row] = await context.db.select({ patient: patients, hospital: hospitals.name, encounterId: encounters.id, state: encounters.state }).from(patients)
      .innerJoin(hospitals, eq(hospitals.id, patients.hospitalId)).leftJoin(encounters, eq(encounters.patientId, patients.id))
      .where(eq(patients.id, context.patientId));
    if (!row) throw new ORPCError("NOT_FOUND", { message: "Your record was not found" });
    const dischargedAt = (row.state as { discharge?: { dischargedAt?: string } } | null)?.discharge?.dischargedAt;
    return { patientId: row.patient.id, name: row.patient.name, firstName: firstName(row.patient.name), hospital: row.hospital, encounterId: row.encounterId ?? undefined, dischargedAt };
  }),
};
