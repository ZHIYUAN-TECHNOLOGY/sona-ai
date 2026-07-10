import type { KnowledgeDoc } from "./corpus";

// Pluggable corpus registry. The bundled corpus is registered as one source; a
// licensed / imported corpus can be added later at runtime with registerCorpusSource
// (e.g. after a clinic imports a MOH/WHO pack) WITHOUT touching any consumer — they
// all read getCorpus(). Merge is by insertion order, de-duplicated by id (an earlier
// source wins), so the bundled entries stay stable when extra packs are added.
//
// Everything stays on-device: sources are in-memory doc arrays, never fetched here.

const sources = new Map<string, KnowledgeDoc[]>();

/** Register (or replace) a corpus source by id. */
export function registerCorpusSource(id: string, docs: KnowledgeDoc[]): void {
  sources.set(id, docs);
}

/** Remove a corpus source (e.g. a clinic revokes a licensed pack). */
export function unregisterCorpusSource(id: string): void {
  sources.delete(id);
}

/** The merged corpus across all registered sources, de-duplicated by id. */
export function getCorpus(): KnowledgeDoc[] {
  const seen = new Set<string>();
  const out: KnowledgeDoc[] = [];
  for (const docs of sources.values()) {
    for (const d of docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      out.push(d);
    }
  }
  return out;
}

/** Registered source ids (for a Settings / provenance view). */
export function corpusSourceIds(): string[] {
  return [...sources.keys()];
}
