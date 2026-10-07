import { and, eq, inArray, like, notInArray } from "drizzle-orm";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core/async";

import { admissions, appointments, bookingRequests, hospitals, pushTokens, auditItems, careCodes, careLinks, careMessages, checkInReplies, checkIns, claims, doseLogs, encounters, findings, guaranteeLetters, handoverAcceptances, labResults, notes, observations, patients, provenance, receipts, tasks, trainingConsents, trainingDatasets, trainingSamples, user, visitSummaries } from "./schema";
import { DEMO_HOSPITAL, SEED_LAB_IDS, seedDemo, seedDemoNote, TEST_PATIENT } from "./seed";

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
  await db.delete(doseLogs).where(eq(doseLogs.hospitalId, DEMO_HOSPITAL));
  await db.delete(bookingRequests).where(eq(bookingRequests.hospitalId, DEMO_HOSPITAL));
  // Phones are re-registered when the patient joins again.
  await db.delete(pushTokens).where(eq(pushTokens.hospitalId, DEMO_HOSPITAL));
  await db.delete(careLinks).where(eq(careLinks.hospitalId, DEMO_HOSPITAL));
  await db.delete(careCodes).where(eq(careCodes.hospitalId, DEMO_HOSPITAL));
  await db.delete(findings).where(eq(findings.hospitalId, DEMO_HOSPITAL));
  await db.delete(tasks).where(eq(tasks.hospitalId, DEMO_HOSPITAL));
  await db.delete(handoverAcceptances).where(eq(handoverAcceptances.hospitalId, DEMO_HOSPITAL));
  await db.delete(auditItems).where(eq(auditItems.hospitalId, DEMO_HOSPITAL));
  await db.delete(appointments).where(and(eq(appointments.hospitalId, DEMO_HOSPITAL), like(appointments.kind, "recall%")));
  // Visits a doctor booked from a flagged check-in ("Book in") go too.
  await db.delete(appointments).where(and(eq(appointments.hospitalId, DEMO_HOSPITAL), like(appointments.id, "book-in:%")));
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
    // Sona Care: readings patients added at home, and the questions they saved for a visit.
    await db.delete(observations).where(and(inArray(observations.patientId, people), eq(observations.source, "patient")));
  }
  await db.update(appointments).set({ prep: null }).where(eq(appointments.hospitalId, DEMO_HOSPITAL));
  // After-visit summaries, drafted or approved, come from note saves during a run.
  await db.delete(visitSummaries).where(eq(visitSummaries.hospitalId, DEMO_HOSPITAL));
  const beds = (await db.select({ id: admissions.id }).from(admissions).where(eq(admissions.hospitalId, DEMO_HOSPITAL))).map(a => a.id);
  await db.update(admissions).set({ dischargedAt: null, fitAt: null }).where(eq(admissions.hospitalId, DEMO_HOSPITAL));
  if (beds.length) await db.update(guaranteeLetters).set({ status: "requested", receivedAt: null }).where(inArray(guaranteeLetters.admissionId, beds));
  // Training data: samples, exports and patients' consents go, and the hospital stops contributing (the demo turns both on).
  await db.delete(trainingSamples).where(eq(trainingSamples.hospitalId, DEMO_HOSPITAL));
  await db.delete(trainingDatasets).where(eq(trainingDatasets.hospitalId, DEMO_HOSPITAL));
  await db.delete(trainingConsents).where(eq(trainingConsents.hospitalId, DEMO_HOSPITAL));
  // The demo clock goes back to real time. A CLI cannot announce "demo": the apps re-read the clock on reconnect or foreground.
  await db.update(hospitals).set({ clockOffsetMs: 0, contributesTraining: false }).where(eq(hospitals.id, DEMO_HOSPITAL));
  await seedDemo(db, now);
  await seedDemoNote(db, now); // Amelia's saved note comes back with the rest of the seed
  // The demo patient's Sona Care account stays linked to Amelia, so the phone is ready after a reset.
  const [demo] = await db.select({ id: user.id }).from(user).where(eq(user.email, TEST_PATIENT.email));
  if (demo) await db.insert(careLinks).values({ userId: demo.id, hospitalId: DEMO_HOSPITAL, patientId: TEST_PATIENT.patientId }).onConflictDoNothing();
}
