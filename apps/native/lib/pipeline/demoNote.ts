// Scripted note source for Demo mode — the Consult-note counterpart of mockStt.
// When the Demo master switch is armed, draftNote swaps the on-device LLM for
// this: the ideal model output for the locked demo consult, streamed word-by-word
// so the live-draft UI (and the filming take) looks exactly like real generation,
// finishing in a predictable ~9s. Everything downstream is UNCHANGED — the script
// rides the same LlmLike contract, so title/flags/SOAP parsing, re-identification,
// persistence and audit all run for real.
//
// The text is written de-identified (no names, no tokens) and mirrors
// mockStt.LOCKED_RAW_TRANSCRIPT beat-for-beat: yellow productive cough, 3-day
// fever, denied chest pain (stays unhighlighted), present mild breathlessness
// (red chip), vitals 38.2 / 92 / 97%, viral assessment, paracetamol 1 g QID,
// review + FBC + safety-net. Flags line carries the one true red flag.

import type { LlmLike } from "./noteGen";

export const LOCKED_DEMO_NOTE = [
  "Title: Productive cough with fever",
  "## Subjective",
  "- Cough with yellow sputum, fever for three days, worse at night",
  "- Mild breathlessness on strong coughing",
  "- No chest pain",
  "## Objective",
  "- Temperature 38.2, pulse 92, SpO2 97%",
  "- Throat red, chest clear",
  "## Assessment",
  "- Viral upper respiratory tract infection",
  "## Plan",
  "- Paracetamol 1 g four times a day",
  "## Orders & follow-ups",
  "- Review in one week",
  "- FBC if not improving",
  "- Return earlier if very breathless",
  "Flags: breathlessness",
].join("\n");

// Smart Scan counterparts: scripted summaries riding docSummary's
// formatDocSummary path, so the final card is formatted by the exact
// production code. Two scripts, selected by the DETECTED document type:
//
// 1. The seeded demo referral letter (lib/demo/seed.ts DEMO_DOC_TEXT —
//    three-week cough, completed amoxicillin, paracetamol PRN, metformin,
//    NSAID allergy, imaging request).
export const LOCKED_DEMO_DOC_SUMMARY = [
  "Title: Referral for persistent cough",
  "## Document type",
  "- Referral letter requesting further assessment",
  "## Key findings",
  "- Persistent productive cough for three weeks",
  "- NSAID allergy with facial swelling",
  "## Medications & doses",
  "- Amoxicillin 500mg TDS, course completed",
  "- Paracetamol 1g QID as needed",
  "- Metformin 500mg BD",
  "## Follow-up needed",
  "- Assess for further imaging and management",
].join("\n");

// 2. The LIVE-SCAN filming prop: the handwritten White Tusk dental
//    prescription (12/10/22 — Augmentin 625mg and Enzoflam after meals,
//    Pan-D 40mg before meals, all 1-0-1/1-0-0 × 5 days, Hexigel gum paint
//    advice × 1 week). Key findings stays "Not stated." on purpose — the
//    prescription carries no findings, and the honest gap is itself the
//    anti-hallucination demo beat. No patient name anywhere (PII rules).
export const LOCKED_DEMO_RX_SUMMARY = [
  "Title: Dental prescription, five-day course",
  "## Document type",
  "- Handwritten dental clinic prescription",
  "## Key findings",
  "- Not stated.",
  "## Medications & doses",
  "- Tab Augmentin 625mg, 1-0-1 x 5 days, after meals",
  "- Tab Enzoflam, 1-0-1 x 5 days, after meals",
  "- Tab Pan-D 40mg, 1-0-0 x 5 days, before meals",
  "## Follow-up needed",
  "- Hexigel gum paint massage, 1-0-1 x 1 week",
].join("\n");

/** Pick the scripted Smart Scan summary matching the detected document type. */
export function demoDocSummaryFor(docTypeLabel: string): string {
  return /referral/i.test(docTypeLabel) ? LOCKED_DEMO_DOC_SUMMARY : LOCKED_DEMO_RX_SUMMARY;
}

// Word-level cadence ≈ a 1.7B model's decode rate on-device; ~120 words × 75ms
// lands the full draft in roughly nine seconds — a good filming beat.
const TOKEN_INTERVAL_MS = 75;

/**
 * Stream `text` word-by-word into `onToken` (accumulated text each tick) and
 * resolve with the full text — the shared engine for every scripted demo AI beat.
 */
export async function streamDemoText(
  text: string,
  onToken: (accumulated: string) => void,
  intervalMs: number = TOKEN_INTERVAL_MS,
): Promise<string> {
  const words = text.split(/(?<=\S)(\s+)/); // keep separators (incl. newlines)
  let acc = "";
  for (const w of words) {
    acc += w;
    if (/\S/.test(w)) {
      onToken(acc);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  return text;
}

/**
 * An LlmLike that "generates" the locked demo note: streams it word-by-word into
 * `onToken` (accumulated text, ready to render) and resolves with the full text.
 */
export function makeDemoNoteLlm(onToken: (accumulated: string) => void): LlmLike {
  return {
    generate: () => streamDemoText(LOCKED_DEMO_NOTE, onToken),
  };
}
