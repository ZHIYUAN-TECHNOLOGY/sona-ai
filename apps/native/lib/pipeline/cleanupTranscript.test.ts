// Pure test for the conservative transcript-cleanup guardrails. No device, no native LLM.
//   npx tsx lib/pipeline/cleanupTranscript.test.ts

import assert from "node:assert/strict";

import { applyCleanup, parseCleanArray, cleanupClusters } from "./cleanupTranscript";
import type { ClusterSegment } from "./sttAlign";
import type { LlmLike } from "./noteGen";

let checks = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  checks++;
};

const cands: ClusterSegment[] = [
  { cluster: 0, text: "good morning and chutra is a cough today", rawText: "good morning and chutra is a cough today" },
  { cluster: 1, text: "demam dah tiga hari", rawText: "demam dah tiga hari" },
];

// parseCleanArray tolerates surrounding text + <think> and extracts the array.
ok(
  JSON.stringify(parseCleanArray('<think>hmm</think> Sure: ["a","b"] done')) === '["a","b"]',
  "parses array out of noisy reply (think stripped)",
);
ok(parseCleanArray("not json at all") === null, "no array → null");
ok(parseCleanArray('{"a":1}') === null, "object, not array → null");

// Happy path: same-length array → cleaned text applied, rawText preserved.
const good = applyCleanup(
  cands,
  JSON.stringify(["Good morning. [unclear], is it a cough today?", "Demam dah tiga hari."]),
);
ok(good[0].text === "Good morning. [unclear], is it a cough today?", "cleaned line applied");
ok(good[0].rawText === "good morning and chutra is a cough today", "raw preserved on cleaned line");
ok(good[1].text === "Demam dah tiga hari.", "second cleaned line applied");

// Wrong count → keep every raw line (all-or-nothing on shape).
const wrongCount = applyCleanup(cands, JSON.stringify(["only one line"]));
ok(wrongCount[0].text === cands[0].rawText && wrongCount[1].text === cands[1].rawText, "count mismatch → all raw");

// Malformed JSON → keep raw.
const bad = applyCleanup(cands, "the model rambled without json");
ok(bad[0].text === cands[0].rawText && bad[1].text === cands[1].rawText, "bad JSON → all raw");

// Per-line guardrails: empty string and implausible expansion fall back to raw.
const guarded = applyCleanup(cands, JSON.stringify(["", "x".repeat(cands[1].rawText!.length * 3 + 50)]));
ok(guarded[0].text === cands[0].rawText, "empty cleaned line → raw");
ok(guarded[1].text === cands[1].rawText, "implausibly long cleaned line (hallucination) → raw");

// cleanupClusters: LLM error is swallowed → raw candidates returned (never a blocker).
const throwingLlm: LlmLike = { generate: async () => { throw new Error("model down"); } };
const safe = await cleanupClusters(cands, throwingLlm);
ok(safe.length === 2 && safe[0].text === cands[0].rawText, "LLM failure → raw, no throw");

// cleanupClusters: empty input → empty out, no LLM call.
let called = false;
const spyLlm: LlmLike = { generate: async () => { called = true; return "[]"; } };
const empty = await cleanupClusters([], spyLlm);
ok(empty.length === 0 && !called, "empty candidates → no LLM call");

// eslint-disable-next-line no-console
console.log(`cleanupTranscript: ${checks}/${checks} checks pass`);
