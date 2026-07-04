// Pure unit test for the export module. No device, no native modules.
//
// Run from apps/native/ with:
//   npx tsx lib/export/export.test.ts
// or:
//   node --import tsx lib/export/export.test.ts
//
// Imports the pure modules directly (not ./pdf) so nothing touches expo-print.

import assert from "node:assert/strict";
import { toFhirDocumentReference } from "./fhir";
import { toNoteHtml } from "./html";
import { toNoteText, base64EncodeUtf8 } from "./noteText";
import type { SignedNote } from "./types";

// Sample built from the locked demo consult (gold SOAP note), fully
// re-identified as it would be at export time on-device.
const sample: SignedNote = {
  consultId: "consult-locked-demo-001",
  patientDisplayName: "Rahman bin Ismail",
  clinicianName: "Dr Aisha Lim",
  mmcNo: "MMC 55123",
  signedAtISO: "2026-07-05T09:30:00+08:00",
  soap: {
    subjective:
      "58-year-old man, 3 days of fever, worse at night. Productive cough with yellow sputum, mild exertional breathlessness on coughing. No chest pain.",
    objective: "Temp 38.2 °C, HR 92, SpO₂ 97% on room air. Throat erythematous. Chest clear.",
    assessment: "Acute upper respiratory tract infection, likely viral. No red flags.",
    plan: "Symptomatic management. Paracetamol 1 g QID PRN for fever. Encourage oral fluids and rest.",
  },
  orders: [
    { kind: "review", text: "Review in 1 week if symptoms persist." },
    { kind: "test", text: "FBC if fever does not settle." },
    { kind: "safety-net", text: "Safety-net: return immediately if significantly breathless." },
  ],
};

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

console.log("export module tests");

// --- FHIR DocumentReference -------------------------------------------------
const fhir = toFhirDocumentReference(sample) as Record<string, any>;

check("resourceType is DocumentReference", () => {
  assert.equal(fhir.resourceType, "DocumentReference");
});

check("status is current", () => {
  assert.equal(fhir.status, "current");
});

check("type is LOINC 11488-4 Consult note", () => {
  const coding = fhir.type.coding[0];
  assert.equal(coding.system, "http://loinc.org");
  assert.equal(coding.code, "11488-4");
  assert.equal(coding.display, "Consult note");
});

check("date equals signedAtISO", () => {
  assert.equal(fhir.date, sample.signedAtISO);
});

check("subject and author reference contained resources", () => {
  assert.equal(fhir.subject.reference, "#patient");
  assert.equal(fhir.author[0].reference, "#author");
  const ids = fhir.contained.map((r: any) => r.id);
  assert.ok(ids.includes("patient"));
  assert.ok(ids.includes("author"));
});

check("content attachment is base64 text/plain", () => {
  const att = fhir.content[0].attachment;
  assert.equal(att.contentType, "text/plain; charset=utf-8");
  assert.ok(typeof att.data === "string" && att.data.length > 0);
  // Round-trip the base64 back to the plain-text body.
  const decoded = Buffer.from(att.data, "base64").toString("utf8");
  assert.equal(decoded, toNoteText(sample));
  assert.ok(decoded.includes("Rahman bin Ismail"));
});

check("base64 encoder round-trips UTF-8 (degree sign / SpO2)", () => {
  const s = "Temp 38.2 °C, SpO₂ 97%";
  assert.equal(Buffer.from(base64EncodeUtf8(s), "base64").toString("utf8"), s);
});

// --- Printable HTML ---------------------------------------------------------
const html = toNoteHtml(sample);

check("HTML contains all SOAP section headers", () => {
  assert.ok(html.includes("Subjective"));
  assert.ok(html.includes("Objective"));
  assert.ok(html.includes("Assessment"));
  assert.ok(html.includes("Plan"));
  assert.ok(html.includes("Orders &amp; follow-ups"));
});

check("HTML includes patient, clinician, and an order line", () => {
  assert.ok(html.includes("Rahman bin Ismail"));
  assert.ok(html.includes("Dr Aisha Lim"));
  assert.ok(html.includes("FBC if fever does not settle."));
});

check("HTML escapes content (no raw unescaped ampersand in orders label)", () => {
  assert.ok(!html.includes("Orders & follow"));
});

console.log(`\n${passed} checks passed`);
