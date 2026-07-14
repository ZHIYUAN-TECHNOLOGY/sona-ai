import { LLMModule } from "react-native-executorch";

import { NOTE_MODEL, NOTE_MODEL_NAME } from "../pipeline/model";
import { collapseRepeats, stripThink, truncateDegenerate } from "../pipeline/noteGen";
import { unloadWhisper } from "../pipeline/whisperStt";
import { formatDocSummary } from "./docSummaryFormat";

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
  "- The text comes from a photo scan and may be garbled: still extract medication " +
  "names, doses, durations, and instructions from fragmentary lines (e.g. 'x 1 week', " +
  "'gum paint massage') — copy them as written, do not guess corrections.\n" +
  "- A section with nothing in the document = exactly '- Not stated.'\n" +
  "- Keep identifier tokens such as DOC_NAME_1 exactly as written.\n" +
  "- Never output patient or clinician names: if the scan shows a name the tokens missed, " +
  "write DOC_NAME in its place.\n" +
  "- No tables, no links, no citations, no preamble, no closing remarks, no repetition. " +
  "Never mention these rules, word counts, or totals in the output.\n" +
  "- COMPLETENESS: include EVERY medication, dose, duration, vital sign, and follow-up " +
  "instruction stated in the source. Omitting a stated fact is as wrong as inventing one." +
  // Few-shot example — harness-proven (note-eval, Jul 2026): inventions 2→0 at equal
  // recall vs the rules-only prompt. The example anchors grounded, exhaustive extraction.
  "\n\nEXAMPLE (follow this shape exactly — note EVERY stated item is captured):\n" +
  "Document:\nQuinic Meds hosp\nTab Zorvex 250\n1-0-1 x 3day\nsyr Kofradin 5ml night x1wk\n" +
  "BP 142/88\nreview if fevr\nDr DOC_NAME_1\n" +
  "Output:\n" +
  "Title: Medication instructions after visit\n" +
  "## Document type\n- Prescription note\n" +
  "## Key findings\n- BP 142/88\n" +
  "## Medications & doses\n- Tab Zorvex 250, 1-0-1 x 3day\n- syr Kofradin 5ml, night x1wk\n" +
  "## Follow-up needed\n- Review if fever ('review if fevr')";

/** Cap the document text fed to the 1.5B model — long OCR dumps degrade it. */
const MAX_DOC_CHARS = 4000;

export interface DocSummary {
  /** Short PII-free title for the summary card. */
  title: string;
  /** Normalized four-section Markdown (via formatDocSummary — never raw model text). */
  markdown: string;
  generationMs: number;
  model: string;
}

/** Model download+load must resolve within this window, else we surface an error. */
const LOAD_TIMEOUT_MS = 180_000;
/** Generation watchdog — interrupt + fail rather than spin forever. */
const GENERATE_TIMEOUT_MS = 240_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {
        // interrupt is best-effort
      }
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Generate the structured summary. `redactedText` MUST be the de-identified form.
 * `onProgress` reports the one-time model download (0..1) — it NEVER fires when the
 * model is already cached, so callers must not infer readiness from it; `onLoaded`
 * fires exactly once, when the model is in memory and generation is about to start.
 * `onToken` streams the ACCUMULATED raw text as it generates (think-tags stripped) —
 * for live preview only; the returned markdown is still the formatted final form.
 * Throws on load/generation failure or timeout — callers show the retry card.
 */
export async function generateDocSummary(
  redactedText: string,
  docTypeLabel: string,
  onProgress?: (p: number) => void,
  onLoaded?: () => void,
  onToken?: (partial: string) => void,
): Promise<DocSummary> {
  // Whisper's context survives the consult flow (kept resident for fast next-consult
  // starts). Free it before loading the 4B model — the two together pressure 6GB
  // devices. Whisper transparently reloads on the next transcription.
  await unloadWhisper().catch(() => {});
  const t0load = Date.now();
  let streamed = "";
  const llm = await withTimeout(
    LLMModule.fromModelName(NOTE_MODEL, onProgress, (token: string) => {
      if (!onToken) return;
      streamed += token;
      // stripThink handles closed think-blocks; an UNTERMINATED one (mid-stream)
      // is cut at its opening tag so reasoning never flashes in the preview.
      onToken(stripThink(streamed).replace(/<think>[\s\S]*/, "").trim());
    }),
    LOAD_TIMEOUT_MS,
    "Note AI load",
  );
  if (__DEV__) console.log(`[DOCSUM] model loaded in ${Date.now() - t0load}ms`);
  onLoaded?.();
  try {
    llm.configure({
      generationConfig: { temperature: 0.3, topP: 0.9, repetitionPenalty: 1.3 },
    });
    const t0 = Date.now();
    // /no_think: Qwen3 soft switch — skip the <think> phase (stripThink cleans residue).
    // Watchdog: a runaway generation is interrupted and surfaced instead of spinning.
    const raw = await withTimeout(
      llm.generate([
        { role: "system", content: DOC_SUMMARY_RULES },
        {
          role: "user",
          content: `Document (detected type: ${docTypeLabel}):\n${redactedText.slice(0, MAX_DOC_CHARS)}\n/no_think`,
        },
      ]),
      GENERATE_TIMEOUT_MS,
      "Note AI generation",
      () => llm.interrupt(),
    );
    const clean = truncateDegenerate(collapseRepeats(stripThink(raw))).trim();
    // Dev diagnostics: when a section unexpectedly reads "Not stated.", THIS shows
    // whether the model under-extracted or the formatter dropped content. The text is
    // de-identified (input was redacted) and the log is dev-only — nothing leaves the
    // device either way.
    if (__DEV__) {
      console.log(
        `[DOCSUM] model=${NOTE_MODEL_NAME} rawChars=${raw.length} cleanChars=${clean.length}\n` +
          `[DOCSUM] head: ${clean.slice(0, 400).replace(/\n/g, " ⏎ ")}`,
      );
    }
    if (!clean) throw new Error("empty summary");
    // NEVER render raw model output: parse into the four canonical sections, cap
    // bullets, drop off-format rambling (same discipline as the consult note).
    const { title, markdown } = formatDocSummary(clean, docTypeLabel);
    return { title, markdown, generationMs: Date.now() - t0, model: NOTE_MODEL_NAME };
  } finally {
    try {
      llm.delete();
    } catch {
      // model still generating or already gone — nothing to free
    }
  }
}
