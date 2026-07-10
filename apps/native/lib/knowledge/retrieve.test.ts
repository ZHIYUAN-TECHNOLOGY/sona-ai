// Pure test for on-device Knowledge retrieval. No device, no native module.
//   npx tsx lib/knowledge/retrieve.test.ts

import assert from "node:assert/strict";

import type { KnowledgeDoc } from "./corpus";
import { retrieve } from "./retrieve";

let checks = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  checks++;
};

const fixture: KnowledgeDoc[] = [
  {
    id: "a",
    title: "Chest pain red flags",
    text: "Refer urgently if central chest pain with breathlessness.",
    category: "red-flags",
    source: "NICE",
    keywords: ["chest pain", "sakit dada", "acs"],
  },
  {
    id: "b",
    title: "URTI safety-netting",
    text: "Usually viral; advise fluids and review if breathless.",
    category: "safety-net",
    source: "NICE CKS",
    keywords: ["urti", "cough", "cold"],
  },
  {
    id: "c",
    title: "Ankle sprain",
    text: "RICE; refer if unable to weight-bear.",
    category: "referral",
    source: "NICE",
    keywords: ["ankle", "sprain"],
  },
];

// Relevant retrieval.
ok(retrieve("chest pain", fixture)[0].doc.id === "a", "chest pain → chest-pain entry first");
ok(retrieve("cough", fixture)[0].doc.id === "b", "cough → URTI entry first");
ok(retrieve("ankle", fixture)[0].doc.id === "c", "ankle → sprain entry");

// Malay keyword match (retrieval sees keywords, not just title/text).
ok(retrieve("sakit dada", fixture)[0].doc.id === "a", "Malay 'sakit dada' matches chest pain via keyword");

// Empty / irrelevant queries.
ok(retrieve("", fixture).length === 0, "empty query → no hits");
ok(retrieve("xyzzy nonsense", fixture).length === 0, "no lexical overlap → no hits");

// top-k cap.
ok(retrieve("refer", fixture, 1).length <= 1, "k caps the result count");

// eslint-disable-next-line no-console
console.log(`knowledgeRetrieve: ${checks}/${checks} checks pass`);
