// Pure test for the attached-document note-context builder. No device.
//   npx tsx lib/pipeline/docContext.test.ts

import assert from "node:assert/strict";

import { buildDocContext, DOC_CONTEXT_DOC_CAP, DOC_CONTEXT_TOTAL_CAP } from "./docContext";

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

ok("no docs → empty string (prompt unchanged)", () => {
  assert.equal(buildDocContext([]), "");
});

ok("blank-text docs are dropped", () => {
  assert.equal(buildDocContext([{ title: "Lab result", redactedText: "   " }]), "");
});

ok("single doc includes title + text + framing", () => {
  const ctx = buildDocContext([{ title: "Lab result", redactedText: "Hb 13.2 g/dL" }]);
  assert.match(ctx, /^ATTACHED DOCUMENTS/);
  assert.match(ctx, /\[Lab result\]\nHb 13\.2 g\/dL/);
  assert.match(ctx, /verified by the clinician/);
});

ok("long doc capped at per-doc limit", () => {
  const ctx = buildDocContext([{ title: "Referral", redactedText: "x".repeat(9000) }]);
  const body = ctx.split("\n").at(-1) ?? "";
  assert.equal(body.length, DOC_CONTEXT_DOC_CAP);
});

ok("multiple docs capped at total limit", () => {
  const docs = [1, 2, 3, 4].map((i) => ({
    title: `Doc ${i}`,
    redactedText: "y".repeat(2000),
  }));
  const ctx = buildDocContext(docs);
  const textChars = ctx
    .split("\n")
    .filter((l) => /^y+$/.test(l))
    .reduce((n, l) => n + l.length, 0);
  assert.ok(
    textChars <= DOC_CONTEXT_TOTAL_CAP,
    `doc text ${textChars} exceeds total cap ${DOC_CONTEXT_TOTAL_CAP}`,
  );
  assert.ok(ctx.includes("[Doc 1]") && ctx.includes("[Doc 2]"), "first two docs present");
});

ok("de-identified tokens pass through untouched", () => {
  const ctx = buildDocContext([{ title: "Referral", redactedText: "Patient DOC_NAME_1 referred." }]);
  assert.match(ctx, /DOC_NAME_1/);
});

console.log(`\n${passed} passed`);
