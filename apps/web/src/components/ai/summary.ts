import type { Reference } from "@sona-ai/domain/evidence";

/** Where an answer is: searching, reading the sources, writing, or done. */
export type Phase = "search" | "read" | "write" | "done";
export type StepState = "done" | "current" | "next";
export type RuleTone = "urgent" | "soon" | "good" | "calm";

const ORDER: Phase[] = ["search", "read", "write"];
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The three steps of an answer, each with whether it is done, under way or still to come. */
export function stepsLine(phase: Phase, sources?: number): { phase: Phase; label: string; state: StepState }[] {
  const at = phase === "done" ? ORDER.length : ORDER.indexOf(phase);
  const read = sources ? `Reading ${plural(sources, "source")}` : "Reading the sources";
  const labels: Record<Phase, string> = { search: "Searching the library", read, write: "Writing", done: "" };
  return ORDER.map((p, i) => ({ phase: p, label: labels[p], state: i < at ? "done" : i === at ? "current" : "next" }));
}

/** The line a finished answer folds into: "Read 7 sources in 4 s". */
export function stepsSummary(sources?: number, seconds?: number) {
  const time = seconds === undefined ? "" : ` in ${seconds < 10 ? Math.max(0.1, Math.round(seconds * 10) / 10) : Math.round(seconds)} s`;
  return sources ? `Read ${plural(sources, "source")}${time}` : `Answered${time}`;
}

/** The distinct kinds of an answer's sources, in a fixed order, for the stacked badges. */
export const sourceKinds = (references: Pick<Reference, "kind">[]) =>
  (["study", "library", "image", "record"] as const).filter(kind => references.some(r => r.kind === kind));

/** A rule answer's count line: how many rows need the clinician ("2 patients need you"). */
export function ruleHeading(rows: { tone: RuleTone }[], noun: [string, string] = ["item", "items"]) {
  const n = rows.filter(r => r.tone === "urgent" || r.tone === "soon").length;
  return n ? `${n} ${n === 1 ? noun[0] : noun[1]} need${n === 1 ? "s" : ""} you` : "Nothing needs you";
}
