import type { ScannedDocument } from "../db/types";

// Pure builder for the attached-document block appended to the note model's user
// message. No native imports — unit-tested in docContext.test.ts.

/** Per-doc + total char caps for document context fed to the 1.5B note model. */
export const DOC_CONTEXT_DOC_CAP = 1500;
export const DOC_CONTEXT_TOTAL_CAP = 3000;

/**
 * Build the attached-document block for note generation. Uses each doc's
 * DE-IDENTIFIED text only, capped so a long OCR dump can't crowd the transcript
 * out of the small model's context. Returns "" when there are no docs (prompt
 * unchanged — the common path).
 *
 * KNOWN LIMIT: DOC_ token numbering restarts per document, so two attached docs can
 * both contain a DOC_NAME_1 that names different people. Accepted for v1 — the blocks
 * are labelled per doc, the tokens are never re-identified (applyReidMap is
 * boundary-guarded), and multi-doc consults are rare.
 */
export function buildDocContext(docs: Pick<ScannedDocument, "title" | "redactedText">[]): string {
  const kept = docs.filter((d) => d.redactedText.trim());
  if (kept.length === 0) return "";
  let remaining = DOC_CONTEXT_TOTAL_CAP;
  const blocks: string[] = [];
  for (const d of kept) {
    if (remaining <= 0) break;
    const text = d.redactedText.trim().slice(0, Math.min(DOC_CONTEXT_DOC_CAP, remaining));
    remaining -= text.length;
    blocks.push(`[${d.title}]\n${text}`);
  }
  return (
    "ATTACHED DOCUMENTS (de-identified, verified by the clinician — use as factual " +
    "context; never invent beyond them):\n" +
    blocks.join("\n\n")
  );
}
