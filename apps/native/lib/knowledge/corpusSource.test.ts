// Pure test for the pluggable corpus registry. No device.
//   npx tsx lib/knowledge/corpusSource.test.ts
// NOTE: imports the KnowledgeDoc TYPE only (erased at runtime), so importing corpus.ts
// — which would register the bundled source as a side effect — is avoided and the
// registry starts empty.

import assert from "node:assert/strict";

import type { KnowledgeDoc } from "./corpus";
import { corpusSourceIds, getCorpus, registerCorpusSource, unregisterCorpusSource } from "./corpusSource";

let checks = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  checks++;
};

const doc = (id: string): KnowledgeDoc => ({
  id,
  title: id,
  text: id,
  category: "condition",
  source: "test",
  keywords: [],
});

ok(getCorpus().length === 0, "registry starts empty");

registerCorpusSource("a", [doc("1"), doc("2")]);
ok(getCorpus().length === 2, "one source → its docs");
ok(corpusSourceIds().join(",") === "a", "source id tracked");

// Second source with an overlapping id — de-duped, earlier source wins.
registerCorpusSource("b", [doc("2"), doc("3")]);
const merged = getCorpus();
ok(merged.length === 3, "sources merged, duplicate id dropped");
ok(merged.map((d) => d.id).join(",") === "1,2,3", "insertion order preserved, no dupes");

// Replace a source's docs in place (id + position preserved).
registerCorpusSource("a", [doc("4")]);
const replaced = getCorpus();
ok(replaced.map((d) => d.id).join(",") === "4,2,3", "a's docs replaced (1→4), b unchanged, order kept");

// Remove a source (e.g. licence revoked) — only the other source's docs remain.
unregisterCorpusSource("b");
ok(getCorpus().map((d) => d.id).join(",") === "4", "unregister removes that source's docs");

// eslint-disable-next-line no-console
console.log(`corpusSource: ${checks}/${checks} checks pass`);
