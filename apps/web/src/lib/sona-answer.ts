import { type AnswerCard, type Mark, partsOf } from "@sona-ai/domain/answer-parts";
import { modelName } from "@sona-ai/domain/model-names";
import type { ReactNode } from "react";

import type { RuleRow } from "@/components/ai/rule-answer";
import { type Phase, plural } from "@/components/ai/summary";
import type { Turn as EvidenceTurn } from "@/features/evidence/thread";

/**
 * What a Sona bar turn holds: data the answer panel draws with the answer kit (components/ai), never ready-made JSX,
 * except `node`, a page's own answer (Sona Care's Ask page) shown as it is.
 */
export type SonaAnswer =
  | { kind: "rules"; lead: string; rows: RuleRow[]; heading?: string; by?: string; marks?: Mark[]; cards?: AnswerCard[]; review?: AskReview; /** From general knowledge, not the hospital's records. */ general?: boolean }
  | { kind: "evidence"; turn: EvidenceTurn; encounterId?: string }
  | { kind: "text"; text: string; note?: string }
  /** `text`: the answer's words, when the page has them, so a follow-up can be read with it (`historyOf`). */
  | { kind: "node"; node: ReactNode; text?: string };

/** A turn of the thread as care.ask's `history` takes it: the question and the words the patient got back. */
export type Said = { question: string; answer: string };
/**
 * The thread so far, for a follow-up ("How does it help?") to be read with it: the last 6 answered turns, oldest first,
 * cut to care.ask's limits. A turn with no words (still thinking, failed, a page's answer without `text`) is left out.
 */
export function historyOf(turns: { question: string; state: string; answer?: SonaAnswer }[]): Said[] {
  return turns.flatMap(t => {
    const words = t.state === "done" && (t.answer?.kind === "text" || t.answer?.kind === "node") ? t.answer.text : undefined;
    return words ? [{ question: t.question.slice(0, 2000), answer: words.slice(0, 4000) }] : [];
  }).slice(-6);
}

type Element = { type: string; props: Record<string, unknown>; children?: string[] };
/** The ask catalogue's confirm card (AskReview): what will happen, the button, the receipt, and the op it runs. */
export type AskReview = { title: string; items: string[]; what: string; confirm: string; done: string; op: string };
/**
 * What `ask.free` returns: an ask-catalogue spec, who wrote it, how long the model needs when it is starting, whether it
 * is general knowledge, and the answer's parts (the words to colour, the cards; read loosely with `partsOf`).
 */
export type FreeAnswer = { source?: string; model?: string; waking?: number; general?: boolean; spec?: { root: string; elements: Record<string, Element> }; marks?: unknown; cards?: unknown };

/**
 * The ask spec as a rule answer: AskLead is the lead, AskRows the rows, AskReview the confirm card. Only an
 * `open:<patient>` op stays on a row (the panel opens that patient); the others are the page's own, so those rows are
 * plain. The answer's marks and cards ride beside the spec. Undefined when it says nothing.
 */
export function rulesAnswer(res: FreeAnswer): Extract<SonaAnswer, { kind: "rules" }> | undefined {
  const parts = (res.spec?.elements[res.spec.root]?.children ?? []).map(id => res.spec!.elements[id]);
  let lead = "", review: AskReview | undefined;
  const rows: RuleRow[] = [];
  for (const part of parts) {
    if (part?.type === "AskLead") lead ||= String(part.props.text);
    if (part?.type === "AskRows")
      for (const { id, title, detail, tone, op } of part.props.rows as Required<RuleRow>[])
        rows.push({ id, title, ...(detail ? { detail } : {}), tone, ...op?.startsWith("open:") && { op } });
    if (part?.type === "AskReview") review ??= part.props as AskReview;
  }
  const { marks, cards } = partsOf(res);
  if (!lead && !rows.length && !review && !cards) return undefined;
  // The kit's count line says "Nothing needs you" over calm rows, which would contradict a list of today's visits: count them instead.
  const heading = rows.length && !rows.some(r => r.tone === "urgent" || r.tone === "soon") ? plural(rows.length, "item") : undefined;
  return {
    kind: "rules", lead, rows, ...(heading ? { heading } : {}), ...marks && { marks }, ...cards && { cards }, ...review && { review }, ...res.general && { general: true },
    by: res.source === "model" ? modelName(res.model) : res.source === "rules" ? "rules" : undefined,
  };
}

/**
 * What a streamed Sona Care answer shows before it is whole (care.askStream): the 999 card, the card the fast lane
 * drafted with Sona's line over it, and the words so far.
 */
export type Live = { sos?: AnswerCard; lane?: { card: AnswerCard; lead?: string }; words: string };
type Part<T> = { type: "call999"; card: AnswerCard } | { type: "lane"; card: AnswerCard; lead?: string } | { type: "words"; at: number; text: string } | { type: "answer"; answer: T };
/**
 * care.askStream read as it comes, each change to `onLive`, ending with the answer care.ask gives (`whole`, which a
 * server without askStream, or a stream that breaks, is asked instead).
 */
export async function streamed<T>(stream: () => Promise<AsyncIterable<Part<T>>>, whole: () => Promise<T>, onLive: (live: Live) => void): Promise<T> {
  let live: Live = { words: "" };
  try {
    for await (const part of await stream()) {
      if (part.type === "answer") return part.answer;
      live = part.type === "words" ? { ...live, words: live.words.slice(0, part.at) + part.text }
        : part.type === "call999" ? { ...live, sos: part.card } : { ...live, lane: { card: part.card, lead: part.lead } };
      onLive(live);
    }
  } catch { /* asked whole below */ }
  return whole();
}

/** Where a streamed evidence turn is, for the Steps line: searching, reading the sources, writing, or done (answered or failed). */
export function phaseOf(turn: EvidenceTurn): Phase {
  if (turn.answer || turn.failed) return "done";
  // apply() names the write step "Reading the sources and writing the answer" (features/evidence/thread.ts).
  if (turn.bottomLine || turn.claims.length || turn.step.includes("writing")) return "write";
  return turn.references.length || turn.step.startsWith("Reading") ? "read" : "search";
}

/** The patient a row opens (`open:<id>`), if any. */
export const rowPatient = (row: Pick<RuleRow, "op">) => (row.op?.startsWith("open:") ? row.op.slice(5) : undefined);
