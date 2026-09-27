import { expect, test } from "bun:test";

import { jsonIn, SPEECH_MODEL, TEXT_MODEL, workersModels, type WorkersAi } from "./workers-models";

/** A fake Workers AI: answers by model, records what it was asked. */
function fake(answers: Record<string, unknown | (() => never)>) {
  const calls: [string, Record<string, unknown>][] = [];
  const ai: WorkersAi = {
    async run(model, input) {
      calls.push([model, input]);
      const a = answers[model];
      if (typeof a === "function") (a as () => never)();
      return a;
    },
  };
  return { ai, calls };
}

test("jsonIn finds the JSON in a fenced or chatty reply, and nothing in prose", () => {
  expect(jsonIn('```json\n{"label":"worse"}\n```')).toEqual({ label: "worse" });
  expect(jsonIn('Sure! {"a":1} hope that helps')).toEqual({ a: 1 });
  expect(jsonIn("no json here")).toBeUndefined();
});

test("a Manglish reply is read by Gemma: label and a short symptom for the doctor's task, named as the model", async () => {
  const { ai, calls } = fake({ [TEXT_MODEL]: { response: '{"label":"worse","symptom":"Fever back, cough worse"}' } });
  const read = await workersModels(ai).classifyReply({ text: "Demam balik, batuk makin teruk", language: "ms" });
  expect(read).toEqual({ label: "worse", symptom: "Fever back, cough worse", source: "model", model: TEXT_MODEL });
  expect(JSON.stringify(calls[0]![1])).toContain("Demam balik, batuk makin teruk");
});

test("the keyword rule's urgent words always win over a milder model reading", async () => {
  const { ai } = fake({ [TEXT_MODEL]: { response: '{"label":"worse","symptom":"chest discomfort"}' } });
  expect((await workersModels(ai).classifyReply({ text: "sakit dada sikit", language: "ms" })).label).toBe("urgent");
});

test("a failed or unreadable model call falls back to the rule, labelled fixture", async () => {
  const down = fake({ [TEXT_MODEL]: () => { throw new Error("model down"); } });
  expect(await workersModels(down.ai).classifyReply({ text: "demam balik", language: "ms" })).toEqual({ label: "worse", source: "fixture" });
  const garbled = fake({ [TEXT_MODEL]: { response: "I think the patient is okay" } });
  expect((await workersModels(garbled.ai).classifyReply({ text: "ok je", language: "ms" })).source).toBe("fixture");
});

test("speech goes to Whisper as base64 in the plan's language, and the words come back trimmed", async () => {
  const { ai, calls } = fake({ [SPEECH_MODEL]: { text: " Demam balik. ", transcription_info: { language: "ms" } } });
  const heard = await workersModels(ai).transcribe({ audio: new TextEncoder().encode("RIFF-audio"), language: "ms" });
  expect(heard).toEqual({ text: "Demam balik.", language: "ms", source: "model", model: SPEECH_MODEL });
  expect(calls[0]![1]).toMatchObject({ audio: btoa("RIFF-audio"), language: "ms", vad_filter: true });
});

test("a plan answer carries whether the plan said it and whether it is urgent; an empty answer falls back", async () => {
  const { ai } = fake({ [TEXT_MODEL]: { response: '{"answer":"Take it after food.","grounded":true,"urgent":false,"from":"medicines"}' } });
  expect(await workersModels(ai).answerFromPlan({ question: "Bila makan ubat?", plan: "Medicines: ...", language: "ms" }))
    .toEqual({ answer: "Take it after food.", grounded: true, urgent: false, from: "medicines", source: "model", model: TEXT_MODEL });
  const empty = fake({ [TEXT_MODEL]: { response: '{"answer":"","grounded":true}' } });
  expect((await workersModels(empty.ai).answerFromPlan({ question: "?", plan: "", language: "en" })).source).toBe("fixture");
});

test("SEA-LION's OpenAI-shaped answer (choices[0].message.content) is read the same way", async () => {
  const { ai } = fake({ [TEXT_MODEL]: { choices: [{ message: { content: '```json\n{"label":"urgent","symptom":"breathless when talking"}\n```' } }] } });
  expect(await workersModels(ai).classifyReply({ text: "nafas pendek bila cakap", language: "ms" }))
    .toEqual({ label: "urgent", symptom: "breathless when talking", source: "model", model: TEXT_MODEL });
});
