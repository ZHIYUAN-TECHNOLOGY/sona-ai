import { useLLM } from "react-native-executorch";
import { useCallback, useEffect, useState } from "react";

import { NOTE_MODEL } from "@/lib/pipeline/model";
import { stripThink } from "@/lib/pipeline/noteGen";

import type { KnowledgeDoc } from "./corpus";
import { buildRagMessages, citedIndices } from "./ragPrompt";
import type { KnowledgeHit } from "./retrieve";

export type AnswerStatus = "idle" | "loading-model" | "thinking" | "done" | "error";

export interface GroundedAnswer {
  text: string;
  question: string;
  sources: KnowledgeDoc[];
  /** 1-based indices of the sources the answer actually cited. */
  cited: number[];
}

/**
 * Opt-in grounded answer for the Knowledge tab. The on-device Qwen is loaded LAZILY —
 * only after the clinician taps "Generate answer" (preventLoad flips off), so the tab
 * has no cold-start cost and the retrieval cards remain the default. Given the
 * retrieved snippets, the model answers strictly from them and cites inline (see
 * ragPrompt). Entirely on-device: the question + snippets never leave the phone, and
 * nothing is persisted. Falls back to "error" (→ show the cards) on any failure.
 */
export function useGroundedAnswer() {
  const [requested, setRequested] = useState(false);
  const llm = useLLM({ model: NOTE_MODEL, preventLoad: !requested });
  const [pending, setPending] = useState<{ question: string; sources: KnowledgeDoc[] } | null>(null);
  const [answer, setAnswer] = useState<GroundedAnswer | null>(null);
  const [status, setStatus] = useState<AnswerStatus>("idle");

  // Generate once the (lazily-loaded) model is ready and a request is queued.
  useEffect(() => {
    if (!pending || !llm.isReady) return;
    const { question, sources } = pending;
    setPending(null);
    setStatus("thinking");
    llm
      .generate(buildRagMessages(question, sources))
      .then((raw) => {
        const text = stripThink(raw).trim();
        setAnswer({ text, question, sources, cited: citedIndices(text, sources.length) });
        setStatus("done");
      })
      .catch(() => setStatus("error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, llm.isReady]);

  const ask = useCallback(
    (question: string, hits: KnowledgeHit[]) => {
      if (hits.length === 0) return;
      setAnswer(null);
      setRequested(true); // lazy-load the model on first ask
      setPending({ question, sources: hits.map((h) => h.doc) });
      setStatus(llm.isReady ? "thinking" : "loading-model");
    },
    [llm.isReady],
  );

  const clear = useCallback(() => {
    setAnswer(null);
    setPending(null);
    setStatus("idle");
  }, []);

  return { ask, clear, answer, status, downloadProgress: llm.downloadProgress };
}
