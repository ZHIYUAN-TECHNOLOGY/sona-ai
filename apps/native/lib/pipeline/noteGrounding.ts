import type { KnowledgeDoc } from "@/lib/knowledge/corpus";
import { retrieve } from "@/lib/knowledge/retrieve";

// Grounds note generation in the on-device reference corpus. From the DE-IDENTIFIED
// transcript we retrieve the most relevant guideline snippets and build a compact
// context block the note model may use to strengthen safety-netting / red-flag advice.
// Pure + unit-tested. Moat-safe: the query is de-identified transcript text, the corpus
// is generic (no PII), and retrieval runs on-device — nothing crosses the boundary.

export interface GuidelineContext {
  /** Numbered [G1..] reference block to append to the note-gen system prompt. "" if none. */
  context: string;
  /** The referenced corpus entries, for the note's citation chips. */
  refs: KnowledgeDoc[];
}

export function buildGuidelineContext(
  query: string,
  corpus: KnowledgeDoc[],
  k = 3,
): GuidelineContext {
  const refs = retrieve(query, corpus, k).map((h) => h.doc);
  if (refs.length === 0) return { context: "", refs: [] };
  const context = refs.map((r, i) => `[G${i + 1}] ${r.title}: ${r.text}`).join("\n");
  return { context, refs };
}
