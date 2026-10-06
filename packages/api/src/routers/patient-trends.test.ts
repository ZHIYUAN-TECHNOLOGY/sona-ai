import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { hospitalMembers, hospitals, labResults, observations } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";

import { appRouter } from "./index";

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

async function signedIn() {
  const now = new Date("2026-09-26T10:00:00+08:00");
  const db = await createTestDb();
  await seedDemo(db, now);
  await addClinician(db, "dr-aisyah");
  await addClinician(db, "beds-kim", undefined, "bed-manager");
  await db.insert(hospitals).values({ id: "other", name: "Other Hospital (synthetic)" });
  await db.insert(hospitalMembers).values({ userId: "dr-other", hospitalId: "other" });
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), now: () => now } });
  return { db, api: as("dr-aisyah"), as };
}

test("a patient's trends are their observations and numeric labs from the last 12 months, per kind and test, oldest first", async () => {
  const { db, api, as } = await signedIn();
  const obs = (id: string, at: string, value: number) => ({ id, patientId: "SYN-1086", kind: "weight", value, unit: "kg", sourceId: id, observedAt: new Date(at) });
  await db.insert(observations).values([obs("w-new", "2026-08-01T00:00:00Z", 71), obs("w-old", "2026-03-01T00:00:00Z", 74), obs("w-ancient", "2025-09-01T00:00:00Z", 80), obs("w-future", "2026-10-01T00:00:00Z", 70)]);
  await db.insert(labResults).values([
    { id: "k-march", patientId: "SYN-1086", test: "Potassium", value: "4.2", unit: "mmol/L", sourceId: "k-march", receivedAt: new Date("2026-03-01T00:00:00Z") },
    { id: "culture", patientId: "SYN-1086", test: "Blood culture", value: "no growth", sourceId: "culture", receivedAt: new Date("2026-03-01T00:00:00Z") },
  ]);

  const trends = await api.patients.trends({ patientId: "SYN-1086" });
  expect(trends.observations.find(o => o.kind === "weight")).toEqual({
    kind: "weight", source: "clinical", unit: "kg", points: [{ at: new Date("2026-03-01T00:00:00Z"), value: 74 }, { at: new Date("2026-08-01T00:00:00Z"), value: 71 }],
  });
  // The seeded potassium (3.1, low) follows March's; the culture's text and the ward's pending samples are not points.
  expect(trends.labs.find(l => l.test === "Potassium")).toEqual({
    test: "Potassium", unit: "mmol/L", points: [{ at: new Date("2026-03-01T00:00:00Z"), value: 4.2, flag: null }, { at: new Date("2026-09-26T00:00:00Z"), value: 3.1, flag: "low" }],
  });
  expect(trends.labs.map(l => l.test).sort()).toEqual(["Hb", "Potassium"]);

  expect((await as("dr-other").patients.trends({ patientId: "SYN-1086" }).catch(e => e)).code).toBe("NOT_FOUND");
  expect((await as("beds-kim").patients.trends({ patientId: "SYN-1086" }).catch(e => e)).code).toBe("FORBIDDEN");
});

test("results list one patient's results when asked, and a rule-flagged result says which limit it crossed", async () => {
  const { api, as } = await signedIn();
  const critical = await api.results.receive({ patientId: "SYN-1042", test: "Potassium", value: "6.8", unit: "mmol/L" });

  const hers = await api.results.list({ patientId: "SYN-1042" });
  expect(hers.map(r => [r.id, r.why])).toEqual([[critical.id, "Potassium 6.8 mmol/L is above the call-now limit of 6 mmol/L"]]);
  // A flag no rule set (the seeded "low") carries no reason; the filters combine; another hospital sees nothing.
  expect((await api.results.list({ patientId: "SYN-1086" })).map(r => [r.test, r.why])).toEqual([["Potassium", undefined], ["Hb", undefined]]);
  expect(await api.results.list({ patientId: "SYN-1086", unacknowledged: true })).toHaveLength(2);
  expect((await api.results.list()).length).toBe(3);
  expect(await as("dr-other").results.list({ patientId: "SYN-1042" })).toEqual([]);
});
