import { useTextEmbeddings } from "react-native-executorch";
import { useCallback, useEffect, useRef, useState } from "react";

import { getNoteEmbeddings, getSearchDocs, saveNoteEmbedding } from "@/lib/db";
import { topKByCosine } from "@/lib/knowledge/vector";
import { EMBED_MODEL, EMBED_MODEL_NAME } from "@/lib/pipeline/model";

import { rankNotes, type SearchDoc, type SearchHit } from "./noteSearch";

export type NoteSearchMode = "semantic" | "keyword";
export interface NoteSearchResult {
  hits: SearchHit[];
  mode: NoteSearchMode;
}

// Short context window around the earliest query-term hit; else the head of the text.
function snippet(text: string, query: string): string {
  const lower = text.toLowerCase();
  const toks = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  let idx = -1;
  for (const t of toks) {
    const i = lower.indexOf(t);
    if (i >= 0 && (idx < 0 || i < idx)) idx = i;
  }
  if (idx < 0) return text.length > 90 ? `${text.slice(0, 90).trim()}…` : text;
  const s = Math.max(0, idx - 30);
  const e = Math.min(text.length, idx + 60);
  return `${s > 0 ? "…" : ""}${text.slice(s, e).trim()}${e < text.length ? "…" : ""}`;
}

/**
 * Semantic search over the clinician's stored notes, via the executorch MiniLM
 * embedder + a persisted on-device vector store (note_embedding). On mount it loads
 * the notes, reuses any cached vectors, embeds the rest once, and persists them — so
 * subsequent searches (and app launches) skip re-embedding. Query → cosine over the
 * note vectors. DEGRADES to the lexical ranker until the model is ready or on any
 * error. Everything is on-device: notes, vectors, and the query never leave the phone.
 */
export function useSemanticNoteSearch() {
  const embed = useTextEmbeddings({ model: EMBED_MODEL });
  const docsRef = useRef<SearchDoc[]>([]);
  const vecsRef = useRef<Map<string, Float32Array>>(new Map());
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState(0);

  const backfill = useCallback(async () => {
    const docs = await getSearchDocs();
    docsRef.current = docs;
    setCount(docs.length);
    if (!embed.isReady) return;
    try {
      const cached = await getNoteEmbeddings(EMBED_MODEL_NAME);
      const map = new Map<string, Float32Array>();
      for (const c of cached) map.set(c.consultId, Float32Array.from(c.vec));
      for (const d of docs) {
        if (map.has(d.consultId)) continue;
        const v = await embed.forward(`${d.title}. ${d.text}`);
        map.set(d.consultId, v);
        await saveNoteEmbedding(d.consultId, EMBED_MODEL_NAME, Array.from(v));
      }
      vecsRef.current = map;
      setReady(map.size > 0);
    } catch {
      // leave lexical fallback in place
    }
  }, [embed.isReady]);

  useEffect(() => {
    void backfill();
  }, [backfill]);

  const search = useCallback(
    async (query: string, k = 20): Promise<NoteSearchResult> => {
      const q = query.trim();
      const docs = docsRef.current;
      if (!q) return { hits: [], mode: ready ? "semantic" : "keyword" };
      if (ready) {
        try {
          const qv = await embed.forward(q);
          const entries = docs.filter((d) => vecsRef.current.has(d.consultId));
          const vecs = entries.map((d) => vecsRef.current.get(d.consultId)!);
          const ranked = topKByCosine(qv, vecs, k, 0.2);
          return {
            hits: ranked.map((r) => ({
              doc: entries[r.index],
              score: r.score,
              snippet: snippet(entries[r.index].text, q),
            })),
            mode: "semantic",
          };
        } catch {
          // fall through to lexical
        }
      }
      return { hits: rankNotes(q, docs).slice(0, k), mode: "keyword" };
    },
    [ready, embed],
  );

  return { search, semanticReady: ready, downloadProgress: embed.downloadProgress, count };
}
