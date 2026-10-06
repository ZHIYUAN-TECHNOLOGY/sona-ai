import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { labResults } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";

import { chatModels } from "../chat-models";
import { stubModels, type Models } from "../models";
import { appRouter } from "./index";

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

const now = new Date("2026-09-26T10:00:00+08:00"), ago = (hours: number) => new Date(now.getTime() - hours * 3600_000);

/** Amelia has one result her doctor has seen and a newer critical one nobody has; SYN-1086 has results of their own. */
async function world(models?: Models) {
  const db = await createTestDb();
  await seedDemo(db, now);
  await addClinician(db, "dr-aisyah");
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), now: () => now, models } });
  const doctor = as("dr-aisyah"), amelia = as("amelia-account");
  await amelia.care.join({ code: (await doctor.care.code({ encounterId: "visit-1042" })).code });
  const { patientId } = await amelia.care.me();
  await db.insert(labResults).values([
    { id: "lab-t-crp", patientId, test: "CRP", value: "48", unit: "mg/L", flag: "high", sourceId: "lab-t-crp", receivedAt: ago(5), acknowledgedBy: "dr-aisyah", acknowledgedAt: ago(4) },
    { id: "lab-t-k", patientId, test: "Potassium", value: "6.4", unit: "mmol/L", flag: "critical", sourceId: "lab-t-k", receivedAt: ago(1) },
  ]);
  const mine = async () => (await amelia.care.results.list()).filter(r => r.id.startsWith("lab-t-"));
  return { db, doctor, amelia, patientId, mine };
}

test("Amelia sees her own results newest first; one no doctor has acknowledged hides its value and flag", async () => {
  const { amelia, mine, patientId } = await world();
  expect(patientId).not.toBe("SYN-1086");
  expect(await mine()).toEqual([
    { id: "lab-t-k", test: "Potassium", at: ago(1), released: false, acknowledged: false },
    { id: "lab-t-crp", test: "CRP", at: ago(5), released: true, acknowledged: true, value: "48", unit: "mg/L", flag: "high" },
  ]);
  expect(JSON.stringify(await amelia.care.results.list({ lang: "ms" }))).not.toContain("6.4");
});

test("another patient's result is never listed or explained", async () => {
  const { amelia, doctor } = await world();
  await doctor.results.acknowledge({ resultId: "lab-1086-potassium" });
  expect((await amelia.care.results.list()).map(r => r.id)).not.toContain("lab-1086-potassium");
  await expect(amelia.care.results.explain({ resultId: "lab-1086-potassium", lang: "en" })).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("an unreleased result cannot be explained until a doctor acknowledges it; the stub's words are labelled fixture", async () => {
  const { amelia, doctor, mine } = await world();
  await expect(amelia.care.results.explain({ resultId: "lab-t-k" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await doctor.results.acknowledge({ resultId: "lab-t-k" });
  expect((await mine())[0]).toMatchObject({ id: "lab-t-k", released: true, value: "6.4", flag: "critical" });
  expect(await amelia.care.results.explain({ resultId: "lab-t-k", lang: "ms" }))
    .toEqual({ text: "Keputusan anda ialah Potassium 6.4 mmol/L. Pasukan penjagaan anda telah melihatnya; tanya mereka apa maksudnya untuk anda.", source: "fixture" });
});

test("a model's explanation is asked for in the patient's language; a box still starting says so; a failed call falls back", async () => {
  const asked: string[] = [];
  const hosted = { ...stubModels, ...chatModels(async (_, said) => { asked.push(said); return { text: " CRP shows swelling in the body. Yours is high. " }; }, "chat-test", stubModels) };
  expect(await (await world(hosted)).amelia.care.results.explain({ resultId: "lab-t-crp", lang: "zh" })).toEqual({ text: "CRP shows swelling in the body. Yours is high.", source: "model" });
  expect(asked).toEqual(["Result: CRP 48 mg/L (flagged high). Answer in Chinese."]);
  const waking: Models = { ...stubModels, explainResult: async input => ({ ...await stubModels.explainResult(input), waking: 3 }) };
  expect(await (await world(waking)).amelia.care.results.explain({ resultId: "lab-t-crp" })).toMatchObject({ source: "fixture", waking: 3 });
  const down = chatModels(async () => { throw new Error("down"); }, "chat-test", stubModels);
  expect((await down.explainResult({ test: "CRP", value: "48", language: "en" })).source).toBe("fixture");
});

test("a clinician is not a patient: the route is refused without a care link", async () => {
  const { doctor } = await world();
  await expect(doctor.care.results.list()).rejects.toThrow();
});
