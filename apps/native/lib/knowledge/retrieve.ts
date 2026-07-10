import { rankNotes, type SearchDoc } from "@/lib/search/noteSearch";

import type { KnowledgeDoc } from "./corpus";

export interface KnowledgeHit {
  doc: KnowledgeDoc;
  score: number;
}

/**
 * Retrieve the top-k most relevant corpus entries for a query. Reuses the on-device
 * lexical ranker (lib/search/noteSearch) by adapting each KnowledgeDoc into a
 * searchable doc whose text includes its keywords (so a Malay term or synonym still
 * matches). Pure + deterministic; runs entirely on-device.
 *
 * The KnowledgeHit shape is stable so an embedding-based re-rank can slot in later
 * without changing the Knowledge screen.
 */
export function retrieve(query: string, docs: KnowledgeDoc[], k = 5): KnowledgeHit[] {
  const adapted: SearchDoc[] = docs.map((d) => ({
    consultId: d.id,
    title: d.title,
    text: `${d.text} ${d.keywords.join(" ")}`,
    createdAt: 0,
    status: d.category,
  }));
  const byId = new Map(docs.map((d) => [d.id, d]));
  return rankNotes(query, adapted)
    .slice(0, k)
    .map((h) => ({ doc: byId.get(h.doc.consultId)!, score: h.score }));
}
