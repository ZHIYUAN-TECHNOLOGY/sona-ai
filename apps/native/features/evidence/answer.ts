import { segments } from "@/components/sona/marked-terms";
import { startingReply } from "@/features/live/waking";
import type { Claim, Reference, Topic } from "./model";

/**
 * Pure helpers for the evidence answer: the steps line while Sona works, the one-line summary once it has answered, what
 * the answer rests on, the claims grouped by topic, and the line that ties a pneumonia answer to this patient.
 */
export type Step = { step: "search" } | { step: "read"; studies: number; passages: number } | { step: "write" };
export type StepLine = { key: Step["step"]; text: string; done: boolean };

/**
 * Evidence text with its key terms marked, red kept for alerts about a patient: in general evidence, "severe pneumonia"
 * or "intensive care" is a finding (teal), not a must-not-miss for anyone. The marks go in as markup, so the dictionary
 * is not run again on the text.
 */
export const calmTerms = (text: string) => segments(text).map(s => (s.mark ? `[[${s.text}|${s.mark === "alert" ? "finding" : s.mark}]]` : s.text)).join("");

const sources = (n: number) => `${n} source${n === 1 ? "" : "s"}`;
/**
 * The checklist while the answer is made, from the server's steps: each step is active until the next one starts (once
 * the answer is in, the checklist gives way to it). Before the first step arrives, searching is already shown.
 */
export function stepLines(steps: Step[]): StepLine[] {
  const shown: Step[] = steps.length ? steps : [{ step: "search" }];
  return shown.map((s, i) => {
    const done = i < shown.length - 1;
    if (s.step === "search") return { key: "search", text: done ? "Searched PubMed and your library" : "Searching PubMed and your library…", done };
    if (s.step === "read") {
      const n = s.studies + s.passages;
      return { key: "read", text: n ? (done ? `Read ${sources(n)}` : `Reading ${sources(n)}…`) : "No sources found", done };
    }
    // Writing is always the last step.
    return { key: "write", text: "Writing the answer…", done };
  });
}

/** The references the claims cite, once each, in order. */
const cited = (claims: Claim[]) => [...new Set(claims.flatMap(c => c.cites))].sort((a, b) => a - b);

/** The steps folded into one line once the answer is in: "PubMed and your library · 4 sources · 3 cited". */
export const searchedLine = (claims: Claim[], references: Reference[]) =>
  `PubMed and your library · ${sources(references.length)}${claims.length ? ` · ${cited(claims).length} cited` : ""}`;

const DESIGN: Record<Reference["design"], [string, string]> = {
  Guideline: ["guideline", "guidelines"], Review: ["systematic review", "systematic reviews"], Trial: ["randomised trial", "randomised trials"],
  "Narrative review": ["narrative review", "narrative reviews"], Study: ["study", "studies"], Library: ["library passage", "library passages"],
};
const ORDER: Reference["design"][] = ["Guideline", "Review", "Trial", "Narrative review", "Study", "Library"];
/** What the answer rests on, strongest first: "From 1 guideline and 2 randomised trials". */
export function basis(claims: Claim[], references: Reference[]) {
  const used = cited(claims).flatMap(n => references.filter(r => r.n === n));
  const parts = ORDER.flatMap(d => { const k = used.filter(r => r.design === d).length; return k ? [`${k} ${DESIGN[d][k === 1 ? 0 : 1]}`] : []; });
  return parts.length ? `From ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]}` : "";
}

/** A citation's short strength label, next to its number: "1 · Guideline". */
export const strength = (design: Reference["design"]) => (design === "Narrative review" ? "Review" : design);

const TOPIC_LABEL: Record<Topic, string> = { evidence: "Evidence", dose: "Dose", harms: "Harms" };
/** The claims under their topics (evidence, dose, harms, in that order); a claim with no topic is evidence. Titles only when there is more than one. */
export function sections(claims: Claim[]): { topic: Topic; title?: string; claims: Claim[] }[] {
  const groups = (Object.keys(TOPIC_LABEL) as Topic[]).map(t => ({ topic: t, claims: claims.filter(c => (c.topic ?? "evidence") === t) })).filter(g => g.claims.length);
  return groups.map(g => ({ topic: g.topic, ...(groups.length > 1 && { title: TOPIC_LABEL[g.topic] }), claims: g.claims }));
}

/**
 * A pneumonia answer in a visit, tied to this patient by their CURB-65: "For Amelia: CURB-65 0, low risk, so the non-severe
 * evidence applies." Nothing when the question is not about pneumonia, the score is incomplete, or it sits at 2 (between).
 */
export function forPatient(question: string, firstName: string, curb?: { score: number; risk?: string } | null) {
  if (!curb?.risk || !/pneumonia|\bCAP\b/i.test(question) || curb.score === 2) return undefined;
  const risk = curb.risk.split(" · ")[0]!.toLowerCase();
  return `For ${firstName}: CURB-65 ${curb.score}, ${risk}, so the ${curb.score <= 1 ? "non-severe" : "severe"} evidence applies.`;
}

/**
 * A live answer with nothing written because the model did not answer, not because the evidence is thin: with a model
 * configured, the server sends that as `source: "fixture"` with no claims (never other text in its place). Says which:
 * the model is starting (`waking` minutes; the screen asks again by itself meanwhile), or it gave no answer. Undefined
 * for anything else, so "not enough evidence" stays what a model said of the sources.
 */
export const NO_MODEL_ANSWER = "Sona's model did not answer. Ask again in a moment.";
export const unanswered = (data: { source: string; enough: boolean; general?: string } | undefined, waking?: number) =>
  !data || data.source !== "fixture" || data.enough || data.general ? undefined : waking ? startingReply(waking) : NO_MODEL_ANSWER;
