import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { admissions, appointments, auditItems, patients, checkInReplies, checkIns, claims, encounters, findings, guaranteeLetters, handoverAcceptances, labResults, notes, provenance, receipts, tasks } from "./schema";
import { resetDemo } from "./reset";
import { DEMO_HOSPITAL, seedDemo } from "./seed";
import { createTestDb } from "./testing";

type Db = Awaited<ReturnType<typeof createTestDb>>;
// biome-ignore lint: any table
const count = async (db: Db, table: any) => (await db.select({ n: sql<number>`count(*)::int` }).from(table))[0]!.n;

test("a demo reset undoes a whole run (discharge, claim, receipts, tasks, findings, check-ins, handover, audit, note edits) and keeps the seed", async () => {
  const db = await createTestDb();
  const now = new Date("2026-09-26T09:00:00+08:00");
  await seedDemo(db, now);
  // A run's worth of activity, written the way the routes write it.
  await db.update(encounters).set({ revision: 3, state: { discharge: { medsConfirmed: true, dischargedAt: now.toISOString() }, medicationEntries: [] } });
  await db.update(admissions).set({ dischargedAt: now, fitAt: now });
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: now });
  await db.update(labResults).set({ acknowledgedBy: "u1", acknowledgedAt: now });
  await db.insert(claims).values({ id: "c1", encounterId: "visit-1042", insurer: "Synthetic insurer", status: "approved", estimateCents: 1, codes: [] });
  await db.insert(receipts).values({ id: "r1", kind: "discharge", encounterId: "visit-1042", requestId: "q1", revision: 3, approvedBy: "u1", payload: {} });
  await db.insert(tasks).values({ id: "t1", hospitalId: DEMO_HOSPITAL, encounterId: "visit-1042", kind: "check-in", title: "Amelia: fever returned", owner: "Attending doctor" });
  await db.insert(findings).values({ id: "f1", hospitalId: DEMO_HOSPITAL, patientId: "SYN-1042", encounterId: "visit-1042", kind: "nodule", label: "9 mm nodule", location: { x: 0.3, y: 0.3, zone: "right upper zone" }, riskBand: "high", source: "fixture" });
  await db.insert(appointments).values({ id: "recall:f1", patientId: "SYN-1042", hospitalId: DEMO_HOSPITAL, startsAt: now, kind: "recall: CT chest" });
  await db.insert(checkIns).values({ id: "ci1", hospitalId: DEMO_HOSPITAL, patientId: "SYN-1042", encounterId: "visit-1042", day: 2, language: "ms", message: "Hai", dueAt: now });
  await db.insert(checkInReplies).values({ id: "cr1", checkInId: "ci1", text: "demam balik", label: "worse", source: "fixture" });
  await db.insert(handoverAcceptances).values({ id: "h1", hospitalId: DEMO_HOSPITAL, fromUser: "u1", toUser: "Dr Lim", cardIds: ["x"] });
  await db.insert(auditItems).values({ id: "a1", hospitalId: DEMO_HOSPITAL, patientId: "SYN-1086", doctor: "Dr", gap: "g", toCode: "D64.9", riskCents: 1, query: "q" });
  await db.insert(notes).values({ id: "n2", encounterId: "visit-1086", revision: 2, sentences: [] });
  await db.insert(labResults).values({ id: "lab-sim-1", patientId: "SYN-1086", test: "Potassium", value: "2.6", unit: "mmol/L", flag: "critical low", sourceId: "lab-sim-1" });
  await db.update(patients).set({ allergies: "Sulfa — edited during the run" });
  await db.insert(provenance).values({ id: "p1", encounterId: "visit-1042", kind: "finding-dismissed", output: {}, sourceIds: [], model: "fixture" });

  await resetDemo(db, now);

  for (const table of [claims, receipts, tasks, findings, checkIns, checkInReplies, handoverAcceptances, auditItems, provenance]) expect(await count(db, table)).toBe(0);
  const visits = await db.select().from(encounters);
  expect(visits.filter(e => e.id.startsWith("visit-10")).map(e => [e.id, e.revision, e.state]).sort()).toEqual([["visit-1042", 1, {}], ["visit-1086", 1, {}]]);
  // The rest of the ward comes back as seeded: every bed occupied, its visit state and fit time restored.
  expect(visits.find(e => e.id === "visit-2014")).toMatchObject({ revision: 1, state: { discharge: { medsConfirmed: false, followUp: "2w" }, transport: { label: "Ride home", detail: "Family free after 17:00" } } });
  const beds = await db.select().from(admissions);
  expect(beds.map(a => a.dischargedAt)).toEqual(beds.map(() => null));
  expect(beds.find(a => a.id === "adm-1042")?.fitAt).toBeNull();
  expect(beds.find(a => a.id === "adm-2002")?.fitAt?.toISOString()).toBe("2026-09-25T20:00:00.000Z");
  expect((await db.select().from(guaranteeLetters)).map(g => [g.status, g.receivedAt])).toEqual([["requested", null], ["requested", null]]);
  expect((await db.select().from(labResults)).every(r => r.acknowledgedAt === null)).toBe(true);
  // Results that arrived during the run are gone, not merely unacknowledged; records return to the seed.
  expect((await db.select().from(labResults)).map(r => r.id).sort()).toEqual(["lab-1086-potassium", "lab-2002-b2-result", "lab-2009-b9-renal", "lab-hb-1086"]);
  expect((await db.select().from(patients)).map(p => p.allergies).sort()).toEqual(["Penicillin — reported rash; details need confirmation", ...Array(7).fill(null)]);
  expect((await db.select().from(notes)).map(n => n.revision)).toEqual([1]);
  expect((await db.select().from(appointments)).map(a => a.id).sort()).toEqual(["appt-SYN-1042", "appt-SYN-1086"]);
});
