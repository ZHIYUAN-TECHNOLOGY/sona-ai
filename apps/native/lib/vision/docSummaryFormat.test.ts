// Pure test for the document-summary post-processor. No device.
//   npx tsx lib/vision/docSummaryFormat.test.ts

import assert from "node:assert/strict";

import { formatDocSummary } from "./docSummaryFormat";

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

ok("well-formed output passes through normalized", () => {
  const raw = [
    "Title: Antibiotic prescription",
    "## Document type",
    "- Prescription",
    "## Key findings",
    "- Post-extraction infection noted",
    "## Medications & doses",
    "- Augmentin 625mg TDS 5 days",
    "## Follow-up needed",
    "- Not stated.",
  ].join("\n");
  const out = formatDocSummary(raw, "Document");
  assert.equal(out.title, "Antibiotic prescription");
  assert.match(out.markdown, /## Document type\n- Prescription/);
  assert.match(out.markdown, /## Medications & doses\n- Augmentin 625mg TDS 5 days/);
});

ok("sloppy '# Doc Type' headings + · bullets still map to canonical sections", () => {
  const raw = [
    "Title: Dental implants and teeth whitening",
    "# Doc Type",
    "General dentists performing dental implant surgery.",
    "# Main Findings",
    "· Patient is male aged approximately twenty-eight years old.",
  ].join("\n");
  const out = formatDocSummary(raw, "Document");
  assert.match(out.markdown, /## Document type\n- General dentists performing dental implant surgery\./);
  assert.match(out.markdown, /## Key findings\n- Patient is male aged approximately twenty-eight years old\./);
});

ok("prose outside any recognized section is dropped (the email-rant killer)", () => {
  const raw = [
    "## Key findings",
    "- Cough for one week",
    "",
    "The email address used was likely associated directly through this website which has an open access policy allowing public use here so it may have been shared publicly.",
  ].join("\n");
  const out = formatDocSummary(raw, "Document");
  assert.ok(!out.markdown.includes("email address"), `rant survived: ${out.markdown}`);
  assert.match(out.markdown, /- Cough for one week/);
});

ok("bullets capped at 3 per section", () => {
  const raw = ["## Key findings", "- a", "- b", "- c", "- d", "- e"].join("\n");
  const out = formatDocSummary(raw, "Document");
  const section = out.markdown.split("## Medications")[0];
  assert.equal((section.match(/^- /gm) ?? []).length - 1, 3); // -1 for Document type's "Not stated."
});

ok("run-on bullets hard-capped with ellipsis", () => {
  const long = "x".repeat(400);
  const out = formatDocSummary(`## Key findings\n- ${long}`, "Document");
  const bullet = out.markdown.split("\n").find((l) => l.startsWith("- x"))!;
  assert.ok(bullet.length <= 163, `bullet too long: ${bullet.length}`);
  assert.ok(bullet.endsWith("…"));
});

ok("empty sections render 'Not stated.' and all four sections always present", () => {
  const out = formatDocSummary("## Key findings\n- Something", "Document");
  for (const h of ["Document type", "Key findings", "Medications & doses", "Follow-up needed"]) {
    assert.ok(out.markdown.includes(`## ${h}`), `missing section ${h}`);
  }
  assert.match(out.markdown, /## Follow-up needed\n- Not stated\./);
});

ok("totally off-format output salvages first lines into Key findings", () => {
  const raw = "The document is a lab report.\nHaemoglobin is 13.2.\nAll values normal.";
  const out = formatDocSummary(raw, "Lab result");
  assert.equal(out.title, "Lab result");
  assert.match(out.markdown, /## Key findings\n- The document is a lab report\./);
  assert.match(out.markdown, /- Haemoglobin is 13\.2\./);
});

ok("missing title falls back to doc type label", () => {
  const out = formatDocSummary("## Key findings\n- x", "Referral letter");
  assert.equal(out.title, "Referral letter");
});

ok("numbered and starred bullets normalize", () => {
  const raw = "## Medications & doses\n1. Paracetamol 500mg\n* Cough syrup 10ml";
  const out = formatDocSummary(raw, "Document");
  assert.match(out.markdown, /- Paracetamol 500mg\n- Cough syrup 10ml/);
});

ok("DOC_ tokens survive untouched", () => {
  const out = formatDocSummary("## Key findings\n- Referred by DOC_NAME_1", "Document");
  assert.match(out.markdown, /DOC_NAME_1/);
});

// Regression: field failure Jul 2026 — model echoed the word-count contract as
// content ("Total :49words") and emitted a mangled "Notstated." variant; both
// rendered as real bullets under Follow-up needed.
ok("contract echoes and Not-stated variants never render as bullets", () => {
  const raw = [
    "## Document type",
    "- Dentist Service Provider",
    "## Key findings",
    "- Not stated.",
    "## Medications & doses",
    "- Not stated.",
    "## Follow-up needed",
    "- Notstated.",
    "Total :49words",
  ].join("\n");
  const out = formatDocSummary(raw, "Document");
  assert.ok(!/total/i.test(out.markdown), `word-count echo survived: ${out.markdown}`);
  assert.ok(!/notstated/i.test(out.markdown), `mangled variant survived: ${out.markdown}`);
  assert.match(out.markdown, /## Follow-up needed\n- Not stated\./);
  assert.match(out.markdown, /## Document type\n- Dentist Service Provider/);
});

ok("word-count echoes in other shapes are dropped too", () => {
  for (const junk of ["(118 words)", "Word count: 97", "Total: 84 words", "Under 120 words."]) {
    const out = formatDocSummary(`## Key findings\n- Real finding\n${junk}`, "Document");
    assert.ok(
      !/\b(words?|count)\b/i.test(out.markdown.replace("Follow-up", "")),
      `echo "${junk}" survived: ${out.markdown}`,
    );
    assert.match(out.markdown, /- Real finding/);
  }
});

console.log(`\n${passed} passed`);
