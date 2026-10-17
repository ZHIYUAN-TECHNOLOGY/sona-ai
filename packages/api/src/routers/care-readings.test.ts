import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { DEMO_HOSPITAL } from "@sona-ai/db/demo";
import { appointments, careLinks, observations } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { Change } from "../events";
import { appRouter } from "./index";

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

const NOW = new Date("2026-09-28T10:05:00+08:00"), DAY = 86_400_000;

/** Amelia (SYN-1042) and Daniel (SYN-1086) each joined Sona Care; each has a visit booked in three days. */
async function world() {
  const db = await createTestDb();
  await seedDemo(db, NOW);
  await addClinician(db, "dr-aisyah");
  for (const [userId, patientId] of [["amelia-user", "SYN-1042"], ["daniel-user", "SYN-1086"]] as const) {
    await db.insert(careLinks).values({ userId, hospitalId: DEMO_HOSPITAL, patientId });
    await db.insert(appointments).values({ id: `next-${patientId}`, patientId, hospitalId: DEMO_HOSPITAL, startsAt: new Date(NOW.getTime() - 60_000 + 3 * DAY), kind: "follow-up" });
  }
  const heard: Change[] = [];
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), now: () => NOW, announce: async (_h, c) => { heard.push(c); } } });
  return { db, doctor: as("dr-aisyah"), amelia: as("amelia-user"), daniel: as("daniel-user"), heard };
}

test("a home reading is logged, charted by kind, and announced", async () => {
  const { amelia, heard } = await world();
  await amelia.care.readings.add({ kind: "blood_pressure", value: 128, value2: 82, takenAt: new Date(NOW.getTime() - DAY) });
  await amelia.care.readings.add({ kind: "blood_pressure", value: 124, value2: 80 });
  await amelia.care.readings.add({ kind: "weight", value: 64.5 });
  const { days, series } = await amelia.care.readings.list();
  expect(days).toBe(7);
  expect(series.map(s => [s.kind, s.unit, s.points.map(p => [p.value, "value2" in p ? p.value2 : undefined])])).toEqual([
    ["blood_pressure", "mmHg", [[128, 82], [124, 80]]],
    ["weight", "kg", [[64.5, undefined]]],
  ]);
  expect(heard).toContainEqual({ topic: "readings", patientId: "SYN-1042" });
});

test("a reading no body could show is refused in plain words", async () => {
  const { amelia } = await world();
  await expect(amelia.care.readings.add({ kind: "temperature", value: 98.6 })).rejects.toThrow("doesn't look right");
  await expect(amelia.care.readings.add({ kind: "oxygen_saturation", value: 140 })).rejects.toThrow("doesn't look right");
  await expect(amelia.care.readings.add({ kind: "blood_pressure", value: 120 })).rejects.toThrow("two numbers");
  await expect(amelia.care.readings.add({ kind: "blood_pressure", value: 80, value2: 120 })).rejects.toThrow("two numbers");
  await expect(amelia.care.readings.add({ kind: "weight", value: 60, takenAt: new Date(NOW.getTime() + DAY) })).rejects.toThrow("time");
  expect((await amelia.care.readings.list({ days: 90 })).series).toEqual([]);
});

test("only the patient's own home readings are listed: not another patient's, not the ward's", async () => {
  const { db, amelia, daniel } = await world();
  await daniel.care.readings.add({ kind: "heart_rate", value: 71 });
  // A ward observation of the same kind on Amelia's chart, written the way the clinical side writes (no source given).
  await db.insert(observations).values({ id: "ward-hr", patientId: "SYN-1042", kind: "heart_rate", value: 96, unit: "bpm", sourceId: "ward", observedAt: NOW });
  expect((await amelia.care.readings.list({ days: 90 })).series).toEqual([]);
  expect((await daniel.care.readings.list()).series.flatMap(s => s.points.map(p => p.value))).toEqual([71]);
  const [ward] = await db.select().from(observations).where(eq(observations.id, "ward-hr"));
  expect(ward!.source).toBe("clinical");
});

test("visit prep: the briefing reads the questions, and the readings only when shared", async () => {
  const { amelia, doctor, heard } = await world();
  const lines = async () => (await doctor.encounter.briefing({ encounterId: "visit-1042" })).lines.join("\n");
  await amelia.care.readings.add({ kind: "blood_pressure", value: 128, value2: 82 });
  expect(await amelia.care.visitPrep.get()).toMatchObject({ questions: [], shareReadings: false, doctorWillSee: null });
  expect(await lines()).not.toContain("Shared by the patient");

  const kept = await amelia.care.visitPrep.save({ questions: ["Can I stop the inhaler?"], shareReadings: false });
  expect(kept.doctorWillSee).toContain("Patient's question 1: Can I stop the inhaler?");
  expect(kept.doctorWillSee).not.toContain("Home readings");
  expect(await lines()).not.toContain("128/82");

  const shared = await amelia.care.visitPrep.save({ questions: ["Can I stop the inhaler?"], shareReadings: true });
  expect(shared.doctorWillSee).toContain("Blood pressure 128/82 mmHg (1 logged)");
  expect(await lines()).toContain(shared.doctorWillSee!);
  expect(heard).toContainEqual({ topic: "visitPrep", patientId: "SYN-1042" });

  await expect(amelia.care.visitPrep.save({ questions: ["a", "b", "c", "d"], shareReadings: true })).rejects.toThrow();
  await expect(amelia.care.visitPrep.save({ questions: ["x".repeat(201)], shareReadings: true })).rejects.toThrow();
});

test("a clinician cannot use the patient's routes", async () => {
  const { doctor } = await world();
  await expect(doctor.care.readings.list()).rejects.toThrow();
  await expect(doctor.care.visitPrep.get()).rejects.toThrow();
});
