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
  | { kind: "rules"; lead: string; rows: RuleRow[]; heading?: string; by?: string }
  | { kind: "evidence"; turn: EvidenceTurn; encounterId?: string }
  | { kind: "text"; text: string; note?: string }
  | { kind: "node"; node: ReactNode };

type Element = { type: string; props: Record<string, unknown>; children?: string[] };
/** What `ask.free` returns: an ask-catalogue spec, who wrote it, and how long the model needs when it is starting. */
export type FreeAnswer = { source?: string; model?: string; waking?: number; spec?: { root: string; elements: Record<string, Element> } };

/**
 * The ask spec as a rule answer: AskLead is the lead, AskRows the rows, AskReview's items more rows under its title.
 * Only an `open:<patient>` op stays on a row (the panel opens that patient); the others are the page's own, so those
 * rows are plain. Undefined when the spec says nothing.
 */
export function rulesAnswer(res: FreeAnswer): Extract<SonaAnswer, { kind: "rules" }> | undefined {
  const parts = (res.spec?.elements[res.spec.root]?.children ?? []).map(id => res.spec!.elements[id]);
  let lead = "", heading: string | undefined;
  const rows: RuleRow[] = [];
  for (const part of parts) {
    if (part?.type === "AskLead") lead ||= String(part.props.text);
    if (part?.type === "AskRows")
      for (const { id, title, detail, tone, op } of part.props.rows as Required<RuleRow>[])
        rows.push({ id, title, ...(detail ? { detail } : {}), tone, ...op?.startsWith("open:") && { op } });
    if (part?.type === "AskReview") {
      heading = String(part.props.title);
      for (const title of part.props.items as string[]) rows.push({ title, tone: "calm" });
    }
  }
  if (!lead && !rows.length) return undefined;
  if (!lead) [lead, heading] = [heading ?? "", undefined];
  // The kit's count line says "Nothing needs you" over calm rows, which would contradict a list of today's visits: count them instead.
  if (!heading && rows.length && !rows.some(r => r.tone === "urgent" || r.tone === "soon")) heading = plural(rows.length, "item");
  return { kind: "rules", lead, rows, ...(heading ? { heading } : {}), by: res.source === "model" ? modelName(res.model) : res.source === "rules" ? "rules" : undefined };
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
