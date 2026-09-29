import { expect, test } from "bun:test";

import { layaEvaluator, type ChoiceQuestion } from "./laya";

const capability: ChoiceQuestion = {
  type: "choice",
  instructions: "Which clinical result answers this request?",
  criteria: { briefing: "Summary of the patient's background", medication: "Review current medicines", "not-covered": "None of the above" },
};
const request = { state: { request: "Salbutamol dia ada clash dengan ubat lain tak?" }, questions: { capability }, signal: new AbortController().signal };
const serve = (body: unknown, status = 200, seen: { url?: string; init?: RequestInit } = {}) =>
  (async (url: string, init: RequestInit) => { Object.assign(seen, { url, init }); return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch;

test("Laya's pick becomes the composer's answer, with its calibrated confidence and token count", async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  const evaluate = layaEvaluator({ url: "http://laya.internal/", apiKey: "k", fetcher: serve({ answers: { capability: { choice: "medication", answer_confidence: 0.99 } }, usage: { input_tokens: 80 } }, 200, seen) });
  expect(await evaluate(request)).toEqual({ answers: { capability: { choice: "medication", confidence: 0.99 } }, usage: { inputTokens: 80 } });
  expect(seen.url).toBe("http://laya.internal/v1/systemone");
  expect((seen.init!.headers as Record<string, string>).authorization).toBe("Bearer k");
  expect(JSON.parse(seen.init!.body as string)).toMatchObject({ model: "multilingual", state: request.state, questions: { capability } });
});

test("an unoffered or missing choice, or a failed call, is an error, never a guessed card", async () => {
  await expect(layaEvaluator({ url: "http://l", fetcher: serve({ answers: { capability: { choice: "xray" } } }) })(request)).rejects.toThrow('no offered choice for "capability"');
  await expect(layaEvaluator({ url: "http://l", fetcher: serve({ answers: { capability: { choice: "constructor" } } }) })(request)).rejects.toThrow("no offered choice");
  await expect(layaEvaluator({ url: "http://l", fetcher: serve({ answers: {} }) })(request)).rejects.toThrow("no offered choice");
  await expect(layaEvaluator({ url: "http://l", fetcher: serve("busy", 503) })(request)).rejects.toThrow("Laya answered 503");
});

// Live check against tools/laya-eval/serve.py: LAYA_URL=http://127.0.0.1:8000 bun test src/laya.test.ts
test.skipIf(!process.env.LAYA_URL)("the fine-tuned model picks the medication review for a Manglish interaction question", async () => {
  const { answers } = await layaEvaluator({ url: process.env.LAYA_URL! })(request);
  expect(answers.capability!.choice).toBe("medication");
});
