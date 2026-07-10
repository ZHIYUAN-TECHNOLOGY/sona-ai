import { useTextEmbeddings } from "react-native-executorch";
import { useEffect, useRef, useState } from "react";

import { EMBED_MODEL } from "@/lib/pipeline/model";

import { CORPUS } from "./corpus";
import { retrieve as lexicalRetrieve, type KnowledgeHit } from "./retrieve";
import { topKByCosine } from "./vector";

export type RetrieveMode = "semantic" | "keyword";
export interface RetrieveResult {
  hits: KnowledgeHit[];
  mode: RetrieveMode;
}

// What to embed per corpus entry — title + guidance + keywords, so a Malay keyword
// contributes to the vector even when the guidance text is English.
function docText(id: string): string {
  const d = CORPUS.find((x) => x.id === id)!;
  return `${d.title}. ${d.text} ${d.keywords.join(" ")}`;
}

/**
 * On-device semantic retrieval over the Knowledge corpus, via the executorch
 * multilingual MiniLM embedder. Embeds the (small, static) corpus once the model is
 * ready, then ranks queries by cosine similarity — so "sakit dada" finds the English
 * "chest pain" guideline. DEGRADES to the lexical ranker until the model has
 * downloaded/loaded, or on any embedding error, so the tab always works. On-device
 * only: the query is embedded in-process and never leaves the phone.
 */
export function useSemanticRetrieve() {
  const embed = useTextEmbeddings({ model: EMBED_MODEL });
  const vectorsRef = useRef<Float32Array[] | null>(null);
  const [ready, setReady] = useState(false);

  // Embed the corpus once, when the model becomes ready.
  useEffect(() => {
    if (!embed.isReady || vectorsRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const vecs: Float32Array[] = [];
        for (const d of CORPUS) {
          const v = await embed.forward(docText(d.id));
          if (cancelled) return;
          vecs.push(v);
        }
        vectorsRef.current = vecs;
        if (!cancelled) setReady(true);
      } catch {
        // leave ready=false → callers use the lexical fallback
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [embed.isReady]);

  // Retrieve for a query: semantic when the corpus is embedded, else lexical.
  async function search(query: string, k = 6): Promise<RetrieveResult> {
    const q = query.trim();
    if (!q) return { hits: [], mode: ready ? "semantic" : "keyword" };
    if (ready && vectorsRef.current) {
      try {
        const qv = await embed.forward(q);
        const ranked = topKByCosine(qv, vectorsRef.current, k, 0.25);
        return { hits: ranked.map((r) => ({ doc: CORPUS[r.index], score: r.score })), mode: "semantic" };
      } catch {
        // fall through to lexical
      }
    }
    return { hits: lexicalRetrieve(q, CORPUS, k), mode: "keyword" };
  }

  return {
    search,
    /** true once the corpus is embedded and semantic search is live. */
    semanticReady: ready,
    /** 0..1 embedder model download progress. */
    downloadProgress: embed.downloadProgress,
  };
}
