// Pure test for RAG vector math + prompt building. No device, no native model.
//   npx tsx lib/knowledge/rag.test.ts

import assert from "node:assert/strict";

import type { KnowledgeDoc } from "./corpus";
import { buildRagMessages, citedIndices } from "./ragPrompt";
import { cosineSim, topKByCosine } from "./vector";

let checks = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  checks++;
};

// --- cosineSim ------------------------------------------------------------
ok(Math.abs(cosineSim([1, 0, 0], [1, 0, 0]) - 1) < 1e-9, "identical → 1");
ok(Math.abs(cosineSim([1, 0], [0, 1])) < 1e-9, "orthogonal → 0");
ok(Math.abs(cosineSim([1, 0], [-1, 0]) + 1) < 1e-9, "opposite → -1");
ok(cosineSim([0, 0], [1, 1]) === 0, "zero vector → 0");
ok(cosineSim(new Float32Array([1, 2, 3]), new Float32Array([2, 4, 6])) > 0.999, "scaled → ~1 (Float32)");

// --- topKByCosine ---------------------------------------------------------
{
  const q = [1, 0];
  const docs = [
    [0, 1], // orthogonal
    [1, 0.1], // closest
    [-1, 0], // opposite
    [0.7, 0.7], // 45°
  ];
  const top = topKByCosine(q, docs, 2);
  ok(top.length === 2, "k caps results");
  ok(top[0].index === 1, "closest vector ranks first");
  ok(top[0].score > top[1].score, "sorted descending by score");

  const thresholded = topKByCosine(q, docs, 4, 0.5);
  ok(
    thresholded.every((r) => r.score >= 0.5),
    "minScore drops weak matches",
  );
  ok(!thresholded.some((r) => r.index === 2), "opposite vector excluded by threshold");
}

// --- buildRagMessages -----------------------------------------------------
{
  const sources: KnowledgeDoc[] = [
    { id: "a", title: "Chest pain", text: "Refer if central.", category: "red-flags", source: "NICE", keywords: [] },
    { id: "b", title: "URTI", text: "Usually viral.", category: "safety-net", source: "NICE CKS", keywords: [] },
  ];
  const msgs = buildRagMessages("when to refer chest pain?", sources);
  ok(msgs.length === 2 && msgs[0].role === "system" && msgs[1].role === "user", "system + user messages");
  ok(/only/i.test(msgs[0].content), "system constrains to the provided snippets");
  ok(msgs[1].content.includes("[1] Chest pain") && msgs[1].content.includes("[2] URTI"), "sources numbered");
  ok(msgs[1].content.includes("when to refer chest pain"), "question included");
  ok(msgs[1].content.includes("Source: NICE"), "citation source included");
}

// --- citedIndices ---------------------------------------------------------
ok(citedIndices("Refer urgently [1], and safety-net [2].", 2).join(",") === "1,2", "extracts cited markers");
ok(citedIndices("See [3] and [1].", 2).join(",") === "1", "ignores out-of-range citation");
ok(citedIndices("No citations here.", 2).length === 0, "no markers → empty");

// eslint-disable-next-line no-console
console.log(`rag: ${checks}/${checks} checks pass`);
