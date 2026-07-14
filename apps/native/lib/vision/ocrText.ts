import { redactTranscript } from "../pipeline/redaction";

// Pure text half of the OCR pipeline — page joining + de-identification. No native
// imports, so it is unit-testable under plain node (docType.test.ts). The native
// recognizer half lives in ./ocr.ts.

/** Join per-page texts into one document; page markers only when there are 2+ pages. */
export function joinPages(pages: string[]): string {
  const kept = pages.map((p) => p.trim());
  if (kept.length <= 1) return kept[0] ?? "";
  return kept.map((p, i) => `--- Page ${i + 1} ---\n${p}`).join("\n\n");
}

export interface RedactedDocText {
  /** De-identified text with DOC_-namespaced tokens — the only form that may cross the boundary. */
  redacted: string;
  /** High-confidence identifiers found + redacted. */
  identifiers: number;
}

/**
 * De-identify OCR'd document text with the same redactor as the consult transcript.
 * Tokens are namespaced DOC_NAME_1 / DOC_IC_1 / … so they can NEVER collide with the
 * consult's own re-ID map — applying the consult map to a note that quotes the document
 * must not re-identify a document token as a different person. Document tokens stay
 * tokens (the doc's own re-ID map is intentionally NOT kept — raw text lives on-device
 * next to it anyway, so there is nothing to re-identify remotely).
 */
export function redactDocText(raw: string): RedactedDocText {
  // Structural form-field redaction BEFORE the transcript redactor: scanned paperwork
  // labels names explicitly ("Name: me sachin sansare", "Patient Name - ..."), a form
  // the honorific-based name regexes can't catch (lowercase, no Encik/Dr). The label
  // itself is the high-precision signal — everything after it on that line is a name.
  // Prompt-side suppression was tried and failed (harness, Jul 2026): the model echoes
  // whatever reaches it, so the name must never reach it.
  const fielded = raw.replace(
    /^([^\S\n]*(?:patient|pt|clinician|doctor|dr)?[^\S\n]*name[^\S\n]*[:\-][^\S\n]*)(\S.*)$/gim,
    "$1DOC_NAME_FIELD",
  );
  const res = redactTranscript([{ speaker: "unknown", text: fielded }]);
  const redacted = (res.segments[0]?.text ?? "").replace(
    /\b(NAME_UNCERTAIN|NAME|IC|PHONE|EMAIL|ADDR)_(\d+)\b/g,
    "DOC_$1_$2",
  );
  return { redacted, identifiers: res.highConfidenceCount };
}
