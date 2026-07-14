// Pure test for the scanned-document type classifier. No device.
//   npx tsx lib/vision/docType.test.ts

import assert from "node:assert/strict";

import { classifyDocType } from "./docType";
import { joinPages, redactDocText } from "./ocrText";

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

ok("lab result classifies", () => {
  const r = classifyDocType(
    "LABORATORY REPORT\nHaemoglobin 13.2 g/dL\nReference range 12-15\nSpecimen: blood",
  );
  assert.equal(r.type, "lab-result");
  assert.equal(r.label, "Lab result");
});

ok("referral letter classifies", () => {
  const r = classifyDocType(
    "Dear Dr Lim,\nThank you for seeing this patient. Referral to cardiology for further assessment.",
  );
  assert.equal(r.type, "referral");
});

ok("prescription classifies", () => {
  const r = classifyDocType("Rx\nAmoxicillin 500 mg tablet\nTake TDS after food");
  assert.equal(r.type, "prescription");
});

ok("discharge summary classifies", () => {
  const r = classifyDocType("DISCHARGE SUMMARY\nDate of admission: 1/2/2026\nWard 5B");
  assert.equal(r.type, "discharge");
});

ok("malay lab result classifies", () => {
  const r = classifyDocType("Keputusan makmal\nKolesterol 5.2 mmol/L");
  assert.equal(r.type, "lab-result");
});

ok("plain text falls back to other", () => {
  const r = classifyDocType("Meeting notes about the weather and lunch plans.");
  assert.equal(r.type, "other");
  assert.equal(r.label, "Document");
});

ok("single weak hit stays other", () => {
  const r = classifyDocType("The ward was quiet.");
  assert.equal(r.type, "other");
});

ok("empty text stays other", () => {
  assert.equal(classifyDocType("").type, "other");
});

// --- joinPages ---------------------------------------------------------------

ok("joinPages single page has no marker", () => {
  assert.equal(joinPages(["hello world"]), "hello world");
});

ok("joinPages multi page adds markers", () => {
  const j = joinPages(["page one", "page two"]);
  assert.match(j, /--- Page 1 ---\npage one/);
  assert.match(j, /--- Page 2 ---\npage two/);
});

ok("joinPages empty input", () => {
  assert.equal(joinPages([]), "");
});

// --- redactDocText token namespacing ------------------------------------------

ok("doc tokens are DOC_-namespaced", () => {
  const { redacted, identifiers } = redactDocText(
    "Patient Encik Tan Ah Kow, IC 880101-14-5567, phone 012-3456789.",
  );
  assert.ok(!/\bNAME_1\b/.test(redacted), `un-namespaced NAME token in: ${redacted}`);
  assert.ok(/DOC_/.test(redacted), `expected DOC_ tokens in: ${redacted}`);
  assert.ok(identifiers >= 2, `expected >=2 identifiers, got ${identifiers}`);
});

ok("clean doc text passes through", () => {
  const { redacted, identifiers } = redactDocText("Haemoglobin 13.2 g/dL within range.");
  assert.equal(identifiers, 0);
  assert.match(redacted, /Haemoglobin 13\.2/);
});

// Field leak (Jul 14 2026): lowercase form-field names ("Name: me sachin sansare")
// evade the honorific-based regexes and were echoed into the AI summary. The label
// is the signal — everything after "Name:" on that line becomes a token.
ok("form-field names are redacted regardless of casing", () => {
  const { redacted } = redactDocText("Name: me sachin sansare\nTab Augmentin 625mg 1x5 days");
  assert.ok(!/sachin|sansare/i.test(redacted), `name survived: ${redacted}`);
  assert.match(redacted, /DOC_NAME_FIELD/);
  assert.match(redacted, /Augmentin 625mg/);
});

ok("patient-name label variants are covered, med lines untouched", () => {
  const { redacted } = redactDocText("Patient Name - Lim Wei Jian\nDr Name: tan ah kow\nDose name pattern absent: 5ml");
  assert.ok(!/Wei Jian|ah kow/i.test(redacted), `name survived: ${redacted}`);
  assert.match(redacted, /Dose name pattern absent: 5ml|DOC_NAME_FIELD/);
});

console.log(`\n${passed} passed`);
