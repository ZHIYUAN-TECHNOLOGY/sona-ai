// Pure test for the on-device redactor. No device, no native modules.
//   npx tsx lib/pipeline/redaction.test.ts
// Verifies the Gate-1-relevant behavior against the locked demo consult:
// numbered tokens, the re-ID map, low-confidence handling, and no raw PII leak.

import assert from "node:assert/strict";
import { redactTranscript } from "./redaction";

// Raw transcript as a good STT would emit it (PII in written form).
const raw = [
  { speaker: "doctor" as const, text: "Morning Encik Rahman bin Ismail, how is the cough today?" },
  { speaker: "patient" as const, text: "My IC is 580214-05-5321, phone 012-345 6789." },
  {
    speaker: "doctor" as const,
    text: "Nurse visits No. 12, Jalan Melati, Taman Sri Muda, Shah Alam on Friday.",
  },
  { speaker: "patient" as const, text: "Ask Kak Timah to bring the card." },
];

const r = redactTranscript(raw);
let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}
const deid = r.segments.map((s) => s.text).join(" ");

check("4 high-confidence identifiers removed", () => {
  assert.equal(r.highConfidenceCount, 4);
});

check("1 low-confidence name surfaced (not counted as removed)", () => {
  assert.equal(r.uncertain.length, 1);
  assert.equal(r.uncertain[0].original, "Kak Timah");
  assert.ok(r.uncertain[0].token.startsWith("NAME_UNCERTAIN_"));
});

check("re-ID map maps each token to its real value", () => {
  const byOriginal = Object.fromEntries(Object.entries(r.reidMap).map(([t, v]) => [v, t]));
  assert.equal(byOriginal["Rahman bin Ismail"], "NAME_1");
  assert.equal(byOriginal["580214-05-5321"], "IC_1");
  assert.equal(byOriginal["012-345 6789"], "PHONE_1");
  assert.ok("ADDR_1" in r.reidMap && r.reidMap["ADDR_1"].includes("Jalan Melati"));
});

check("de-identified transcript carries tokens, not raw PII", () => {
  for (const tok of ["NAME_1", "IC_1", "PHONE_1", "ADDR_1", "NAME_UNCERTAIN_1"]) {
    assert.ok(deid.includes(tok), `expected token ${tok}`);
  }
});

check("NO raw identifier survives in the de-identified text (the moat)", () => {
  for (const leak of ["Rahman", "580214", "012-345", "Jalan Melati", "Taman Sri Muda", "Kak Timah"]) {
    assert.ok(!deid.includes(leak), `LEAK: "${leak}" present in text the model would see`);
  }
});

check("honorific is kept, only the name is tokenized", () => {
  assert.ok(deid.includes("Encik NAME_1"));
});

check("repeated value reuses the same token (dedup)", () => {
  const dup = redactTranscript([
    { speaker: "doctor" as const, text: "IC 580214-05-5321." },
    { speaker: "patient" as const, text: "Yes, 580214-05-5321." },
  ]);
  assert.equal(dup.highConfidenceCount, 1); // one distinct identifier, not two
});

console.log(`\n${passed} checks passed`);
