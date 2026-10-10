import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { encounters, guaranteeLetters } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { chatModels, type Chat } from "../chat-models";
import { stubModels, type Models } from "../models";
import { LINES } from "../voice-agent/answer";
import { appRouter } from "./index";

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

/** Amelia discharged in Malay and joined (care-voice.test's world), asking with `models`. */
async function world(models: Models) {
  const now = new Date("2026-09-28T10:05:00+08:00"), db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T15:40:00+08:00"));
  await addClinician(db, "dr-aisyah");
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: now }).where(eq(guaranteeLetters.id, "gl-1042"));
  await db.update(encounters).set({ state: { discharge: { glReceived: true, medsConfirmed: true, followUp: "2w", language: "ms" } } }).where(eq(encounters.id, "visit-1042"));
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), now: () => now, models } });
  const doctor = as("dr-aisyah"), amelia = as("amelia-account");
  await doctor.discharge.request({ encounterId: "visit-1042", requestId: "req-d1", approvedBy: "dr-aisyah" });
  await amelia.care.join({ code: (await doctor.care.code({ encounterId: "visit-1042" })).code });
  return amelia;
}

test("the model's answer reaches her whole: nothing is withheld and no not-found line is added (founder, 9 Oct)", async () => {
  // Her record holds no potassium: the old grounding filter cut that sentence and added "I could not find that in your record".
  const answer = "Ambil Azithromycin sekali sehari. Kalium anda ialah 3.1 mmol/L.";
  const amelia = await world({ ...stubModels, answerFromPlan: async () => ({ answer, grounded: true, urgent: false, from: "medicines", source: "model", model: "gemma-test" }) });
  expect(await amelia.care.ask({ question: "Apa ubat saya?" })).toEqual({ answer, grounded: true, urgent: false, from: "medicines", sources: [], withheld: 0, source: "model", model: "gemma-test" });
});

test("a follow-up is read in the light of the chat so far (staging, 9 Oct: \"How does it help?\" after \"What is panadol\")", async () => {
  const asked: { said: string; maxTokens?: number }[] = [];
  const long = `Paracetamol eases pain and brings a fever down. ${"It is general information. ".repeat(50)}`.trim();
  const chat: Chat = async (_, said, maxTokens) => { asked.push({ said, maxTokens }); return { answer: long, grounded: false, urgent: false, cites: [] }; };
  const amelia = await world({ ...stubModels, ...chatModels(chat, "gemma-test", stubModels) });
  const history = [
    // Sona's told line, if the app sends it back inside an answer, is not shown to the model to copy.
    { question: "What is panadol", answer: `Panadol is paracetamol, a common medicine for pain and fever. ${LINES.en.told}` },
    { question: "Is it safe?", answer: "Yes, at the usual dose." },
  ];
  const answer = await amelia.care.ask({ question: "How does it help?", history });
  // A longer answer than before (800 characters) is shown whole, with room to write it.
  expect(answer).toMatchObject({ answer: long, grounded: false, withheld: 0 });
  expect(long.length).toBeGreaterThan(800);
  expect(asked).toHaveLength(1);
  expect(asked[0]!.maxTokens).toBe(1000);
  expect(asked[0]!.said).toStartWith("Conversation so far:\nPatient: What is panadol\nSona Care: Panadol is paracetamol, a common medicine for pain and fever.\n\nPatient: Is it safe?\nSona Care: Yes, at the usual dose.\n\nPatient's question, written in English.");
  expect(asked[0]!.said).toEndWith(": How does it help?");
  // A first question has no conversation before it; a chat sent with more than six earlier turns is refused.
  await amelia.care.ask({ question: "What is panadol" });
  expect(asked[1]!.said).toStartWith("Patient's question, written in English.");
  const seven = Array.from({ length: 7 }, () => ({ question: "Why?", answer: "Because." }));
  expect((await amelia.care.ask({ question: "And then?", history: seven }).catch(e => e)).code).toBe("BAD_REQUEST");
});
