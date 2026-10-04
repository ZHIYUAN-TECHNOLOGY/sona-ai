import { expect, test } from "bun:test";

import { EMBED_MODEL, jsonIn, SPEECH_MODEL, TEXT_MODEL, workersEmbedder, workersModels, type WorkersAi } from "./workers-models";

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
  expect(read).toEqual({ label: "worse", symptom: "Fever back, cough worse", source: "model", model: TEXT_MODEL, decidedBy: "model" });
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
    .toEqual({ label: "urgent", symptom: "breathless when talking", source: "model", model: TEXT_MODEL, decidedBy: "model" });
});

test("EmbeddingGemma: a question and passages get the model's own prompts, 100 texts a call, each a 768-dim vector", async () => {
  const calls: { model: string; text: string[]; signal?: AbortSignal }[] = [];
  const ai: WorkersAi = {
    async run(model, input, options) {
      const text = input.text as string[];
      calls.push({ model, text, signal: options?.signal });
      return { shape: [text.length, 768], data: text.map((_, i) => new Array(768).fill(i / 1000)) };
    },
  };
  const embed = workersEmbedder(ai);
  expect(await embed([], "document")).toEqual([]);
  expect(calls).toEqual([]);
  expect(await embed(["Steroids in mild pneumonia?"], "query")).toEqual([new Array(768).fill(0)]);
  expect(calls[0]).toMatchObject({ model: EMBED_MODEL, text: ["task: search result | query: Steroids in mild pneumonia?"] });
  // Every call carries its timeout, so a slow Workers AI gives up rather than hold the search.
  expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
  const vectors = await embed(Array.from({ length: 150 }, (_, i) => `CAP guideline\nSteroids\nPassage ${i}`), "document");
  expect(calls.slice(1).map(c => c.text.length)).toEqual([100, 50]);
  expect(calls[1]!.text[0]).toBe("title: none | text: CAP guideline\nSteroids\nPassage 0");
  expect(vectors).toHaveLength(150);
  expect(vectors[149]).toEqual(new Array(768).fill(0.049));
});

test("EmbeddingGemma down or answering out of shape throws, so retrieval falls back instead of storing a wrong vector", async () => {
  const answering = (out: unknown): WorkersAi => ({ run: async () => out });
  await expect(workersEmbedder({ run: async () => { throw new Error("Workers AI 503"); } })(["q"], "query")).rejects.toThrow("503");
  for (const out of [undefined, { data: [] }, { data: [[0.1, 0.2]] }, { data: [new Array(768).fill(Number.NaN)] }]) {
    await expect(workersEmbedder(answering(out))(["q"], "query")).rejects.toThrow("out of shape");
  }
});
