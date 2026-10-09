import { triageByRules } from "@sona-ai/domain/messages";
import { expect, test } from "bun:test";

import { chatModels } from "./chat-models";
import { stubModels } from "./models";

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
