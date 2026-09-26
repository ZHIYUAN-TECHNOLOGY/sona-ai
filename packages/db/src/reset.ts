import { and, eq, inArray, like, notInArray } from "drizzle-orm";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core/async";

import { admissions, appointments, auditItems, careCodes, careLinks, careMessages, checkInReplies, checkIns, claims, encounters, findings, guaranteeLetters, handoverAcceptances, labResults, notes, patients, provenance, receipts, tasks } from "./schema";
import { DEMO_HOSPITAL, SEED_LAB_IDS, seedDemo } from "./seed";

type AnyDb = PgAsyncDatabase<any, any>;

/**
 * Puts the demo hospital back to its seeded start, for a clean demo or recording: everything a run
 * writes (discharges, claims, receipts, tasks, findings, check-ins, handovers, audit items, note
 * edits) is deleted, visits and admissions are reset, and the seed runs again. Synthetic data only;
 * scoped to the demo hospital. Reference tables (ICD-10, drugs, rules) and sign-ins are kept.
 * No transaction (Neon's HTTP driver has none): children go before parents, and rerunning finishes a half-done reset.
 */
export async function resetDemo(db: AnyDb, now = new Date()) {
  const visits = (await db.select({ id: encounters.id }).from(encounters).where(eq(encounters.hospitalId, DEMO_HOSPITAL))).map(e => e.id);
  const people = (await db.select({ id: patients.id }).from(patients).where(eq(patients.hospitalId, DEMO_HOSPITAL))).map(p => p.id);
  const sent = (await db.select({ id: checkIns.id }).from(checkIns).where(eq(checkIns.hospitalId, DEMO_HOSPITAL))).map(c => c.id);
  if (sent.length) await db.delete(checkInReplies).where(inArray(checkInReplies.checkInId, sent));
  await db.delete(checkIns).where(eq(checkIns.hospitalId, DEMO_HOSPITAL));
  // Sona Care: codes, messages and account links go, so a demo starts with the patient joining again.
  await db.delete(careMessages).where(eq(careMessages.hospitalId, DEMO_HOSPITAL));
  await db.delete(careLinks).where(eq(careLinks.hospitalId, DEMO_HOSPITAL));
  await db.delete(careCodes).where(eq(careCodes.hospitalId, DEMO_HOSPITAL));
  await db.delete(findings).where(eq(findings.hospitalId, DEMO_HOSPITAL));
  await db.delete(tasks).where(eq(tasks.hospitalId, DEMO_HOSPITAL));
  await db.delete(handoverAcceptances).where(eq(handoverAcceptances.hospitalId, DEMO_HOSPITAL));
  await db.delete(auditItems).where(eq(auditItems.hospitalId, DEMO_HOSPITAL));
  await db.delete(appointments).where(and(eq(appointments.hospitalId, DEMO_HOSPITAL), like(appointments.kind, "recall%")));
  if (visits.length) {
    await db.delete(receipts).where(inArray(receipts.encounterId, visits));
    await db.delete(claims).where(inArray(claims.encounterId, visits));
    await db.delete(provenance).where(inArray(provenance.encounterId, visits));
    await db.delete(notes).where(inArray(notes.encounterId, visits));
    await db.update(encounters).set({ revision: 1, state: {}, updatedAt: now }).where(inArray(encounters.id, visits));
  }
  if (people.length) {
    // Results that arrived during the run (the simulated lab feed) go; the seeded ones become unacknowledged again.
    await db.delete(labResults).where(and(inArray(labResults.patientId, people), notInArray(labResults.id, SEED_LAB_IDS)));
    await db.update(labResults).set({ acknowledgedBy: null, acknowledgedAt: null }).where(inArray(labResults.patientId, people));
  }
  const beds = (await db.select({ id: admissions.id }).from(admissions).where(eq(admissions.hospitalId, DEMO_HOSPITAL))).map(a => a.id);
  await db.update(admissions).set({ dischargedAt: null, fitAt: null }).where(eq(admissions.hospitalId, DEMO_HOSPITAL));
  if (beds.length) await db.update(guaranteeLetters).set({ status: "requested", receivedAt: null }).where(inArray(guaranteeLetters.admissionId, beds));
  await seedDemo(db, now);
}
