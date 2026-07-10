import { useTextEmbeddings } from "react-native-executorch";
import { useEffect, useMemo, useRef, useState } from "react";

import { EMBED_MODEL } from "@/lib/pipeline/model";

import { getCorpus } from "./corpus";
import { retrieve as lexicalRetrieve, type KnowledgeHit } from "./retrieve";
import { topKByCosine } from "./vector";

export type RetrieveMode = "semantic" | "keyword";
export interface RetrieveResult {
  hits: KnowledgeHit[];
  mode: RetrieveMode;
}

/**
 * On-device semantic retrieval over the Knowledge corpus, via the executorch
 * multilingual MiniLM embedder. Embeds the (small, static) corpus once the model is
 * ready, then ranks queries by cosine similarity — so "sakit dada" finds the English
 * "chest pain" guideline. DEGRADES to the lexical ranker until the model has
 * downloaded/loaded, or on any embedding error, so the tab always works. On-device
 * only: the query is embedded in-process and never leaves the phone.
 *
 * Reads the corpus via getCorpus() (a stable snapshot per hook lifetime) so a licensed
 * pack registered via registerCorpusSource is included automatically.
 */
export function useSemanticRetrieve() {
  const embed = useTextEmbeddings({ model: EMBED_MODEL });
  const corpus = useMemo(() => getCorpus(), []);
  const vectorsRef = useRef<Float32Array[] | null>(null);
  const [ready, setReady] = useState(false);

  // Embed the corpus once, when the model becomes ready. Title + guidance + keywords,
  // so a Malay keyword contributes to the vector even when the guidance is English.
  useEffect(() => {
    if (!embed.isReady || vectorsRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const vecs: Float32Array[] = [];
        for (const d of corpus) {
          const v = await embed.forward(`${d.title}. ${d.text} ${d.keywords.join(" ")}`);
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
  }, [embed.isReady, corpus]);

  // Retrieve for a query: semantic when the corpus is embedded, else lexical.
  async function search(query: string, k = 6): Promise<RetrieveResult> {
    const q = query.trim();
    if (!q) return { hits: [], mode: ready ? "semantic" : "keyword" };
    const lexical = (): RetrieveResult => ({ hits: lexicalRetrieve(q, corpus, k), mode: "keyword" });
    if (ready && vectorsRef.current) {
      try {
        const qv = await embed.forward(q);
        const ranked = topKByCosine(qv, vectorsRef.current, k, 0.25);
        // Empty semantic set → lexical, so a low-cosine exact match is not lost.
        if (ranked.length === 0) return lexical();
        return { hits: ranked.map((r) => ({ doc: corpus[r.index], score: r.score })), mode: "semantic" };
      } catch {
        // fall through to lexical
      }
    }
    return lexical();
  }

  return {
    search,
    /** true once the corpus is embedded and semantic search is live. */
    semanticReady: ready,
    /** 0..1 embedder model download progress. */
    downloadProgress: embed.downloadProgress,
  };
}
