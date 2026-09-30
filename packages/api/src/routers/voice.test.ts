import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";

import { stubModels, type Models } from "../models";
import { appRouter } from "./index";

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

async function doctor(models?: Models) {
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T15:40:00+08:00"));
  await addClinician(db, "dr-aisyah");
  return createRouterClient(appRouter, { context: { db, session: user("dr-aisyah"), now: () => new Date("2026-09-30T10:00:00+08:00"), models } });
}

test("speaking to Sona: refused plainly without a speech model, and 'starting' when the hosted model didn't answer", async () => {
  const off = await (await doctor()).voice.transcribe({ audio: btoa("RIFF-some-audio-bytes") }).catch(e => e);
  expect([off.code, off.data?.code, off.message]).toEqual(["PRECONDITION_FAILED", "SPEECH_OFF", "Speaking to Sona isn't switched on yet. Type instead."]);
  // Hosted but asleep: the adapter falls back to the stub, which says "fixture".
  const cold = await (await doctor({ ...stubModels })).voice.transcribe({ audio: btoa("RIFF-some-audio-bytes") }).catch(e => e);
  expect(cold.message).toBe("The speech model is starting. Try again in a minute, or type.");
  // Known to be starting: the adapter's minutes reach the refusal.
  const starting = await (await doctor({ ...stubModels, transcribe: async () => ({ text: "", source: "fixture" as const, waking: 30 }) })).voice.transcribe({ audio: btoa("RIFF-some-audio-bytes") }).catch(e => e);
  expect([starting.code, starting.data?.code, starting.message]).toEqual(["PRECONDITION_FAILED", "SPEECH_OFF", "The speech model is starting (about 30 min). Try again then, or type."]);
});

test("with the speech model, the clinician's words come back with the model that heard them", async () => {
  let heardBytes = 0;
  const models: Models = { ...stubModels, transcribe: async ({ audio }) => { heardBytes = audio.length; return { text: "Siapa pesakit pertama saya hari ni?", source: "model", model: "sona-asr" }; } };
  const said = await (await doctor(models)).voice.transcribe({ audio: btoa("RIFF-some-audio-bytes"), language: "ms" });
  expect(said).toEqual({ text: "Siapa pesakit pertama saya hari ni?", source: "model", model: "sona-asr" });
  expect(heardBytes).toBe("RIFF-some-audio-bytes".length);
});
