import { LLMModule } from "react-native-executorch";

import { NOTE_MODEL, NOTE_MODEL_NAME } from "../pipeline/model";
import { collapseRepeats, stripThink, truncateDegenerate } from "../pipeline/noteGen";

// On-device "abstract the document" summary — the Heidi-style wow for Smart Scan. Runs the
// note model (Qwen) over the DE-IDENTIFIED, clinician-verified document text and returns a
// short structured Markdown summary. Uses the non-hook LLMModule API because Smart Scan
// lives outside the consult flow's PipelineProvider: the model is loaded, used once, and
// FREED — keeping a second resident 1.1GB copy alongside the consult flow's instance would
// risk jetsam, and a resident copy during a later recording would starve whisper's Metal
// encode (the proven contention failure). Load cost ~seconds; summaries are rare events.

// Same strict anti-hallucination contract as the consult templates (templates.ts BASE_RULES):
// the 1.5B model rambles and invents when given latitude, so: terse bullets, hard caps,
// nothing beyond the document.
const DOC_SUMMARY_RULES =
  "You are a clinical documentation assistant. Summarize the de-identified scanned " +
  "document text into a SHORT structured summary in English.\n" +
  "OUTPUT FORMAT (exactly):\n" +
  "Line 1 — 'Title: ' + 3-6 word summary of the document (no names, IC, phones, tokens).\n" +
  "Then these '## ' Markdown sections, each with 1-3 bullet points ('- '), each bullet " +
  "under 12 words:\n" +
  "## Document type\n## Key findings\n## Medications & doses\n## Follow-up needed\n" +
  "HARD RULES:\n" +
  "- Use ONLY facts stated in the document. NEVER invent findings, values, diagnoses, " +
  "medications, doses, or dates.\n" +
  "- A section with nothing in the document = exactly '- Not stated.'\n" +
  "- Keep identifier tokens such as DOC_NAME_1 exactly as written.\n" +
  "- No tables, no links, no citations, no preamble, no closing remarks, no repetition.\n" +
  "- Total under 120 words.";

/** Cap the document text fed to the 1.5B model — long OCR dumps degrade it. */
const MAX_DOC_CHARS = 4000;

export interface DocSummary {
  /** Structured Markdown summary (Title + sections). De-identified. */
  markdown: string;
  generationMs: number;
  model: string;
}

/**
 * Generate the structured summary. `redactedText` MUST be the de-identified form.
 * `onProgress` reports the one-time model download (0..1) on a fresh install.
 * Throws on load/generation failure — callers fall back to showing the raw text.
 */
export async function generateDocSummary(
  redactedText: string,
  docTypeLabel: string,
  onProgress?: (p: number) => void,
): Promise<DocSummary> {
  const llm = await LLMModule.fromModelName(NOTE_MODEL, onProgress);
  try {
    llm.configure({
      generationConfig: { temperature: 0.3, topP: 0.9, repetitionPenalty: 1.3 },
    });
    const t0 = Date.now();
    const raw = await llm.generate([
      { role: "system", content: DOC_SUMMARY_RULES },
      {
        role: "user",
        content: `Document (detected type: ${docTypeLabel}):\n${redactedText.slice(0, MAX_DOC_CHARS)}`,
      },
    ]);
    const markdown = truncateDegenerate(collapseRepeats(stripThink(raw))).trim();
    if (!markdown) throw new Error("empty summary");
    return { markdown, generationMs: Date.now() - t0, model: NOTE_MODEL_NAME };
  } finally {
    try {
      llm.delete();
    } catch {
      // model still generating or already gone — nothing to free
    }
  }
}
