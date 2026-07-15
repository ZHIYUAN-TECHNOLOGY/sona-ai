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

// Word-level cadence ≈ a 1.7B model's decode rate on-device; ~120 words × 75ms
// lands the full draft in roughly nine seconds — a good filming beat.
const TOKEN_INTERVAL_MS = 75;

/**
 * An LlmLike that "generates" the locked demo note: streams it word-by-word into
 * `onToken` (accumulated text, ready to render) and resolves with the full text.
 */
export function makeDemoNoteLlm(onToken: (accumulated: string) => void): LlmLike {
  return {
    generate: async () => {
      const words = LOCKED_DEMO_NOTE.split(/(?<=\S)(\s+)/); // keep separators (incl. newlines)
      let acc = "";
      for (const w of words) {
        acc += w;
        if (/\S/.test(w)) {
          onToken(acc);
          await new Promise((r) => setTimeout(r, TOKEN_INTERVAL_MS));
        }
      }
      return LOCKED_DEMO_NOTE;
    },
  };
}
