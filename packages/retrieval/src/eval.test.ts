import { expect, test } from "bun:test";
import { createTestDb } from "@sona-ai/db/testing";
import { EVAL_QUESTIONS, evaluate } from "./eval";
import { stubEmbedder } from "./retrieval";

test("the synthetic mini-corpus eval finds the expected source in the top 5 for every question", async () => {
  const db = await createTestDb();
  const result = await evaluate(db, stubEmbedder);
  console.log(`hit@5 = ${result.hitAtK.toFixed(2)} over ${EVAL_QUESTIONS.length} questions (synthetic corpus, stub embedder)`, result.misses);
  expect(EVAL_QUESTIONS.length).toBeGreaterThanOrEqual(8);
  expect(result.misses).toEqual([]);
  expect(result.hitAtK).toBe(1);
});
