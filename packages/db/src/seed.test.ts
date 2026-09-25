import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { admissions, appointments, casemixWeights, guaranteeLetters, insurerCriteria, labResults, observations, patients } from "./schema";
import { DEMO_HOSPITAL, seedDemo } from "./seed";
import { createTestDb } from "./testing";

test("the demo seed has the two visit patients and Amelia in bed 6 awaiting her final GL", async () => {
  const db = await createTestDb();
  await seedDemo(db);
  await seedDemo(db); // seeding twice is harmless
  const rows = await db.select().from(patients).where(eq(patients.hospitalId, DEMO_HOSPITAL));
  expect(rows.map(p => p.name).sort()).toEqual(["Amelia Tan", "Daniel Rahman"]);
  const [bed] = await db.select().from(admissions).where(eq(admissions.patientId, "SYN-1042"));
  expect(bed?.bed).toBe("Bed 6");
  const [gl] = await db.select().from(guaranteeLetters).where(eq(guaranteeLetters.admissionId, bed!.id));
  expect(gl?.status).toBe("requested");
});

test("the chart holds Amelia's CURB-65 readings and Daniel's low potassium, each with a source", async () => {
  const db = await createTestDb();
  await seedDemo(db);
  await seedDemo(db);
  const obs = await db.select().from(observations).where(eq(observations.patientId, "SYN-1042"));
  expect(Object.fromEntries(obs.map(o => [o.kind, `${o.value} ${o.unit}`]))).toEqual({
    confusion: "0 flag", urea: "5.1 mmol/L", "respiratory-rate": "18 /min", systolic: "124 mmHg", diastolic: "78 mmHg",
  });
  expect(obs.every(o => o.sourceId)).toBe(true);
  const [k] = await db.select().from(labResults).where(eq(labResults.patientId, "SYN-1086"));
  expect(k).toMatchObject({ test: "Potassium", value: "3.1", unit: "mmol/L", flag: "low" });
  expect(k?.sourceId).toBeTruthy();
});

test("the demo insurer's criteria for Amelia's claim are rows, the organism rule tied to J18.9", async () => {
  const db = await createTestDb();
  await seedDemo(db);
  await seedDemo(db);
  const rows = await db.select().from(insurerCriteria).where(eq(insurerCriteria.insurer, "Synthetic insurer"));
  expect(rows.map(r => r.label).sort()).toEqual([
    "Imaging result attached", "Organism documented", "Reason for IV antibiotics", "Severity score documented", "Stay within the approved plan",
  ]);
  expect(rows.find(r => r.label === "Organism documented")?.code).toBe("J18.9");
});

test("every coding-audit code has a casemix weight, and each audit's specific code weighs more than the vague one", async () => {
  const db = await createTestDb();
  await seedDemo(db);
  await seedDemo(db);
  const w = Object.fromEntries((await db.select().from(casemixWeights)).map(r => [r.code, r.weight]));
  const pairs = [["K35.8", "K35.3"], ["I50.9", "I50.0"], ["I64", "I63.9"], ["L03.9", "L03.1"], ["J44.9", "J44.1"], ["A41.9", "A41.5"], ["J45.9", "J46"]] as const;
  for (const [vague, specific] of pairs) expect(w[specific]!).toBeGreaterThan(w[vague]!);
  for (const code of ["J18.9", "N10", "D64.9", "E87.1", "N17.9"]) expect(w[code]).toBeGreaterThan(0);
});

test("both visit patients have one appointment today, still today when seeded again on a later day", async () => {
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-25T09:00:00+08:00"));
  await seedDemo(db, new Date("2026-09-26T09:00:00+08:00"));
  const rows = await db.select().from(appointments).orderBy(appointments.startsAt);
  expect(rows.map(r => [r.patientId, r.startsAt.toISOString()])).toEqual([
    ["SYN-1042", "2026-09-26T01:15:00.000Z"],
    ["SYN-1086", "2026-09-26T01:45:00.000Z"],
  ]);
});
