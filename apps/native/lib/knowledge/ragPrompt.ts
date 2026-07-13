import type { Msg } from "@/lib/pipeline/noteGen";

import type { KnowledgeDoc } from "./corpus";

// Builds the on-device RAG prompt: the model answers the doctor's question USING ONLY
// the retrieved guideline snippets, cites them inline, and refuses to go beyond them.
// Pure (no native dep) so it's unit-tested; the grounding rules live here, not in the UI.

const RAG_SYSTEM =
  "You are a clinical reference assistant for a doctor in Malaysian primary care. " +
  "Answer the question USING ONLY the numbered reference snippets provided below. " +
  "Be concise — 2 to 4 sentences. Cite the snippets you use inline as [1], [2], etc. " +
  "If the references do not answer the question, say so plainly and do not use outside " +
  "knowledge or invent facts. This is reference support to aid the clinician's own " +
  "judgement, not a directive or a diagnosis. Do not restate the question.";

/**
 * Assemble the chat messages for a grounded answer. `sources` are the retrieved
 * corpus entries, in rank order; they are numbered [1..n] so the model can cite them,
 * and the same list drives the citation chips shown under the answer.
 */
export function buildRagMessages(question: string, sources: KnowledgeDoc[]): Msg[] {
  const refs = sources
    .map((s, i) => `[${i + 1}] ${s.title} — ${s.text} (Source: ${s.source})`)
    .join("\n");
  return [
    { role: "system", content: RAG_SYSTEM },
    // /no_think: Qwen3 soft switch — skip the <think> phase (stripThink cleans residue).
    { role: "user", content: `Question: ${question.trim()}\n\nReferences:\n${refs}\n/no_think` },
  ];
}

/** Which of the numbered sources the answer actually cites (1-based [n] markers). */
export function citedIndices(answer: string, sourceCount: number): number[] {
  const found = new Set<number>();
  for (const m of answer.matchAll(/\[(\d+)\]/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= sourceCount) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}
