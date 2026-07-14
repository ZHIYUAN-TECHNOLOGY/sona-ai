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
  const long = "patient reports mild dizziness ".repeat(14).trim(); // ~430 chars, realistic words
  const out = formatDocSummary(`## Key findings\n- ${long}`, "Document");
  const bullet = out.markdown.split("\n").find((l) => l.startsWith("- patient"))!;
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

// Regression: quantized-model glyph noise (field screenshots, Jul 2026) — Cyrillic
// confusables, sub/superscript digits, diacritics, letter-spaced doses, filler chars.
ok("model glyph noise is folded to plain Latin", () => {
  const raw = [
    "## Medications & doses",
    "- Augмenтин tab., 6 2 5 mg, 1 x ₅days",
    "- .Tab.Enzflemán :‰ 0 x five_days",
    "## Follow-up needed",
    "- Adu.:Hexigel gum pint,x __one_week",
  ].join("\n");
  const out = formatDocSummary(raw, "Document");
  assert.match(out.markdown, /Augmentun tab\., 625 mg, 1 x 5days/);
  assert.ok(!/[Ѐ-ӿ]/.test(out.markdown), `cyrillic survived: ${out.markdown}`);
  assert.ok(!/[₀-₉‰]/.test(out.markdown), `sub‑scripts/filler survived: ${out.markdown}`);
  assert.match(out.markdown, /Enzfleman/);
  assert.match(out.markdown, /one_week|one week/);
});

ok("sanitizer leaves clean text and CJK untouched", () => {
  const out = formatDocSummary("## Key findings\n- 喉咙很痛, Paracetamol 1 g QID", "Document");
  assert.match(out.markdown, /喉咙很痛, Paracetamol 1 g QID/);
});

// Regression: tail degeneration evaded word-level guards by having NO SPACES
// (field screenshot Jul 14 2026 — one giant token of letter soup under Follow-up).
ok("space-free gibberish mega-tokens are dropped", () => {
  const raw = [
    "## Follow-up needed",
    "- review If fever ('ReviewIffever')",
    "- DOCNAME:WHITETUSSMALLPACIENTREVIEWDATE:DEC79BECFDEEEDCFFAAADCCBFBCABDBFAEBDFDAFCDDCBDCBAADDCECAADCBDCAFCDCAAACECFADAACAFABCADBACCAXXXXXXXXXXXXYYYYYYZZZWWVVUTSR",
  ].join("\n");
  const out = formatDocSummary(raw, "Document");
  assert.ok(!/WHITETUSS|XXXX|DEC79/.test(out.markdown), `gibberish survived: ${out.markdown}`);
  assert.match(out.markdown, /review If fever/);
});

ok("repeated-char runs are dropped even in short bullets", () => {
  const out = formatDocSummary("## Key findings\n- XXXXXXXX review\n- Real finding", "Document");
  assert.ok(!/XXXX/.test(out.markdown), `run survived: ${out.markdown}`);
  assert.match(out.markdown, /Real finding/);
});

ok("label-only bullets ('Tabs :') are dropped", () => {
  const out = formatDocSummary("## Medications & doses\n- Tabs :\n- Amoxicillin 500 mg TDS", "Document");
  assert.ok(!/Tabs\s*:/.test(out.markdown), `label bullet survived: ${out.markdown}`);
  assert.match(out.markdown, /Amoxicillin 500 mg TDS/);
});

ok("legit long-but-real bullets survive the gibberish net", () => {
  const out = formatDocSummary(
    "## Follow-up needed\n- Review at www.thewhitetusk.com if fever persists beyond three days",
    "Document",
  );
  assert.match(out.markdown, /thewhitetusk\.com/);
});

// Regression #136 (Jul 14): single underscores, LaTeX junk, contact-metadata bullets.
ok("single underscores fold to spaces; DOC tokens keep theirs", () => {
  const raw = "## Medications & doses\n- _Tab._Augmentor_in 625mg, once_every_five_day_s by DOC_NAME_1";
  const out = formatDocSummary(raw, "Document");
  assert.match(out.markdown, /Tab\. Augmentor in 625mg, once every five day s by DOC_NAME_1/);
});

ok("LaTeX fragments and dollar runs are stripped", () => {
  const raw = "## Medications & doses\n- Tab. Enzflemen, once every five days, _$\\geq$ $-$ $+$$";
  const out = formatDocSummary(raw, "Document");
  assert.ok(!/[$\\]/.test(out.markdown), `latex survived: ${out.markdown}`);
  assert.match(out.markdown, /Enzflemen, once every five days/);
});

ok("contact-metadata bullets (Ph/Web/Email) are dropped from any section", () => {
  const raw = [
    "## Follow-up needed",
    "- review if fever",
    "- Ph:+OR CSTN EYI LZB",
    "- _WEB:_www.thewhitetusk.com|",
    "- Email:DOC_EAMLONIONONE_",
  ].join("\n");
  const out = formatDocSummary(raw, "Document");
  assert.ok(!/Ph:|WEB|Email|CSTN/i.test(out.markdown), `contact junk survived: ${out.markdown}`);
  assert.match(out.markdown, /review if fever/);
});

ok("DOC-token protection never collides with real digits in dose text", () => {
  const raw = "## Medications & doses\n- DOC_NAME_1 prescribed 0 - 1x5 days, sig_ned DOC_NAME_2";
  const out = formatDocSummary(raw, "Document");
  assert.match(out.markdown, /DOC_NAME_1 prescribed 0 - 1x5 days, sig ned DOC_NAME_2/);
});

ok("bullets that clean to pure punctuation are dropped (no empty dots)", () => {
  const out = formatDocSummary("## Key findings\n- _\n- $$\n- Real finding", "Document");
  const lines = out.markdown.split("\n").filter((l) => l.startsWith("- "));
  assert.ok(lines.every((l) => /[A-Za-z0-9一-鿿]/.test(l)), `empty bullet: ${JSON.stringify(lines)}`);
  assert.match(out.markdown, /Real finding/);
});

console.log(`\n${passed} passed`);
