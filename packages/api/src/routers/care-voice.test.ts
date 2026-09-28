import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { encounters, guaranteeLetters } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { Models } from "../models";
import { TEXT_MODEL, workersModels, type WorkersAi } from "../workers-models";
import { appRouter } from "./index";

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

/** Amelia discharged and joined; `models` is what the Worker would pass (the stub when undefined). */
async function world(models?: Models) {
  const now = new Date("2026-09-28T10:05:00+08:00");
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T15:40:00+08:00"));
  await addClinician(db, "dr-aisyah");
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: now }).where(eq(guaranteeLetters.id, "gl-1042"));
  await db.update(encounters).set({ state: { discharge: { glReceived: true, medsConfirmed: true, followUp: "2w", language: "ms" } } }).where(eq(encounters.id, "visit-1042"));
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), now: () => now, models } });
  const doctor = as("dr-aisyah"), amelia = as("amelia-account");
  await doctor.discharge.request({ encounterId: "visit-1042", requestId: "req-d1", approvedBy: "dr-aisyah" });
  await amelia.care.join({ code: (await doctor.care.code({ encounterId: "visit-1042" })).code });
  return { doctor, amelia };
}

test("without a speech model, speaking is refused plainly and asking answers nothing (the app keeps its own answers)", async () => {
  const { amelia } = await world();
  const e = await amelia.care.transcribe({ audio: btoa("RIFF-some-audio-bytes") }).catch(e => e);
  expect([e.code, e.data?.code, e.message]).toEqual(["PRECONDITION_FAILED", "SPEECH_OFF", "Speaking to Sona Care isn't switched on yet. Please type instead."]);
  expect(await amelia.care.ask({ question: "Bila saya makan ubat?" })).toEqual({ answer: "", grounded: false, urgent: false, source: "fixture" });
});

test("with the model, her Manglish reply flags the doctor with the model's own words, and her question is grounded in her plan", async () => {
  const asked: string[] = [];
  const ai: WorkersAi = {
    async run(model, input) {
      const text = JSON.stringify(input);
      asked.push(text);
      if (text.includes("Discharge plan")) return { response: '{"answer":"Ambil Azithromycin sekali sehari.","grounded":true,"urgent":false,"from":"medicines"}' };
      return { response: '{"label":"worse","symptom":"Fever back, cough worse"}' };
    },
  };
  const { doctor, amelia } = await world(workersModels(ai));
  const replied = await amelia.care.checkIns.reply({ checkInId: "check-in:visit-1042:2", text: "Demam balik, batuk makin teruk" });
  expect(replied.replies[0]).toMatchObject({ label: "worse", source: TEXT_MODEL, task: { title: "Amelia: fever back, cough worse after discharge" } });
  expect((await doctor.tasks.list()).some(t => t.title === "Amelia: fever back, cough worse after discharge")).toBe(true);

  const answer = await amelia.care.ask({ question: "Bila saya makan ubat?" });
  expect(answer).toEqual({ answer: "Ambil Azithromycin sekali sehari.", grounded: true, urgent: false, from: "medicines", source: "model", model: TEXT_MODEL });
  // Only her own plan went to the model: her medicines and warning signs, nobody else's record.
  const prompt = asked.find(a => a.includes("Discharge plan"))!;
  expect(prompt).toContain("Azithromycin");
  expect(prompt).toContain("The fever comes back");
  expect(prompt).not.toContain("SYN-1086");
});
