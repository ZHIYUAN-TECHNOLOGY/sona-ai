import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { encounters, guaranteeLetters } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { NOT_FOUND } from "@sona-ai/domain/grounding";
import { eq } from "drizzle-orm";

import { stubModels, type Models } from "../models";
import { appRouter } from "./index";

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

/** Amelia discharged in Malay and joined (care-voice.test's world), with a Gemma that always answers `answer` from her record. */
async function asks(answer: string) {
  const now = new Date("2026-09-28T10:05:00+08:00"), db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T15:40:00+08:00"));
  await addClinician(db, "dr-aisyah");
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: now }).where(eq(guaranteeLetters.id, "gl-1042"));
  await db.update(encounters).set({ state: { discharge: { glReceived: true, medsConfirmed: true, followUp: "2w", language: "ms" } } }).where(eq(encounters.id, "visit-1042"));
  const models: Models = { ...stubModels, answerFromPlan: async () => ({ answer, grounded: true, urgent: false, from: "medicines", source: "model", model: "gemma-test" }) };
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), now: () => now, models } });
  const doctor = as("dr-aisyah"), amelia = as("amelia-account");
  await doctor.discharge.request({ encounterId: "visit-1042", requestId: "req-d1", approvedBy: "dr-aisyah" });
  await amelia.care.join({ code: (await doctor.care.code({ encounterId: "visit-1042" })).code });
  return (question: string) => amelia.care.ask({ question });
}

test("a fact the model invents about her is withheld before she sees it: the answer says so once and counts it", async () => {
  const answer = await (await asks("Ambil Azithromycin sekali sehari. Kalium anda ialah 3.1 mmol/L."))("Apa ubat saya?");
  expect(answer).toMatchObject({ answer: `Ambil Azithromycin sekali sehari. ${NOT_FOUND.ms}`, grounded: true, withheld: 1 });
});

test("an answer whose record-based sentences all went is only the not-found line, and not \"from her record\"", async () => {
  expect(await (await asks("Kalium anda ialah 3.1 mmol/L."))("Apa keputusan kalium saya?")).toMatchObject({ answer: NOT_FOUND.ms, grounded: false, withheld: 1 });
});

test("general advice passes untouched: today's real answer", async () => {
  const general = "请多喝水并休息。保持环境空气清新对康复有帮助。如有呼吸困难请立即就医。";
  expect(await (await asks(general))("肺炎康复期间我应该注意什么？")).toMatchObject({ answer: general, grounded: true, withheld: 0 });
});
