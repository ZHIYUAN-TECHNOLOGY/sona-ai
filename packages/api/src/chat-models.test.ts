import { triageByRules } from "@sona-ai/domain/messages";
import { expect, test } from "bun:test";

import { chatModels } from "./chat-models";
import { stubModels } from "./models";
import { messagesFor } from "./voice-agent/answer";

test("the safety floor says so: the rule's urgent words decide over a model's milder reading, and the answer names both", async () => {
  // A model that reads everything mildly: "fine" for a check-in reply, "admin" for a message.
  const models = chatModels(async system => system.includes("check-in") ? { label: "fine" } : { label: "admin", reason: "asks about a bill" }, "chat-test", stubModels);
  expect(await models.classifyReply({ text: "chest pain since this morning", language: "en" })).toEqual({ label: "urgent", source: "model", model: "chat-test", decidedBy: "rules" });
  expect(await models.classifyReply({ text: "Feeling better today", language: "en" })).toEqual({ label: "fine", source: "model", model: "chat-test", decidedBy: "model" });
  expect(await models.triageMessage({ text: "Sakit dada sejak pagi" })).toEqual({ ...triageByRules("Sakit dada sejak pagi"), source: "model", model: "chat-test", decidedBy: "rules" });
  expect(await models.triageMessage({ text: "Where do I pay my bill?" })).toEqual({ label: "admin", reason: "asks about a bill", source: "model", model: "chat-test", decidedBy: "model" });
  // A model that agrees it is urgent decided its own label; one that fails leaves the rules, labelled fixture.
  const agrees = chatModels(async () => ({ label: "urgent", symptom: "chest pain" }), "chat-test", stubModels);
  expect((await agrees.classifyReply({ text: "chest pain since this morning", language: "en" })).decidedBy).toBe("model");
  const down = chatModels(async () => { throw new Error("down"); }, "chat-test", stubModels);
  expect(await down.classifyReply({ text: "chest pain since this morning", language: "en" })).toEqual({ label: "urgent", source: "fixture" });
});

test("an answer in the wrong language is asked for once more, with the same conversation before the question", async () => {
  const said: string[] = [];
  const models = chatModels(async (_, user) => {
    said.push(user);
    return { answer: said.length === 1 ? "Panadol ialah parasetamol, ubat biasa untuk sakit dan demam." : "It eases pain and brings a fever down.", grounded: false, urgent: false };
  }, "chat-test", stubModels);
  const answer = await models.answerFromPlan({ question: "How does it help?", plan: "", language: "en", history: [{ question: "What is panadol", answer: "Panadol is paracetamol." }] });
  expect(answer).toMatchObject({ answer: "It eases pain and brings a fever down.", source: "model" });
  expect(said).toHaveLength(2);
  for (const s of said) expect(s).toStartWith("Conversation so far:\nPatient: What is panadol\nSona Care: Panadol is paracetamol.\n\nPatient's question, written in English.");
  expect(said[1]).toContain("Your last answer was not in English");
});

test("an empty reply is asked for once more, not answered by the stub", async () => {
  const said: string[] = [];
  const models = chatModels(async (_, user) => { said.push(user); return said.length === 1 ? {} : { answer: "There is no strong evidence that vitamin C prevents flu.", grounded: false, urgent: false }; }, "chat-test", stubModels);
  expect(await models.answerFromPlan({ question: "Is it true vitamin C can prevent flu?", plan: "", language: "en" })).toMatchObject({ answer: "There is no strong evidence that vitamin C prevents flu.", source: "model" });
  expect(said).toHaveLength(2);
  expect(said[1]).toContain("Your last reply held no answer");
});

test("typed and spoken answers both put her record's numbers, an asthma attack and a febrile baby before the usual numbers, and no made-up dose time", async () => {
  let typed = "";
  await chatModels(async system => { typed = system; return { answer: "ok" }; }, "chat-test", stubModels).answerFromPlan({ question: "How much water?", plan: "", language: "en" });
  const spoken = messagesFor({ question: "How much water?", plan: "", language: "en", history: [] })[0]!.content;
  for (const prompt of [typed, spoken]) {
    expect(prompt).toContain("their record's own number when it holds one (their dose, a fluid limit)");
    expect(prompt).toContain("1 puff every 30 to 60 seconds up to 10");
    expect(prompt).toContain("(with heart failure or kidney disease, their fluid limit instead)");
    expect(prompt).toMatch(/a baby under 3 months with a fever must (be seen by|see) a doctor today: say that first/);
    expect(prompt).toContain("never a clock time it does not give");
  }
});
