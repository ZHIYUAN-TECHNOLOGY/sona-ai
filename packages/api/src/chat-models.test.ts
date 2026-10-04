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
