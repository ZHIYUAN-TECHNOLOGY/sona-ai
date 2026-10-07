import type { Claim, Reference } from "@sona-ai/domain/evidence";

import type { Answer, StreamEvent } from "@/features/evidence/thread";

import { fixture } from "./fixture";

// /pro/evidence asks evidence.stream when a question is sent. The question is at most 500 characters (askInput); claims,
// sources and their titles are unbounded, so the worst case is a 12-claim answer resting on 20 sources with PubMed-length titles.
const TITLE = "Corticosteroids for adults hospitalised with severe community-acquired pneumonia, including those requiring intensive care admission, mechanical ventilation or vasopressor support: a systematic review, individual patient data meta-analysis and trial sequential analysis of randomised controlled trials published 1950–2025";
const DESIGNS = ["Guideline", "Review", "Trial", "Narrative review", "Study"] as const;
const reference = (n: number): Reference => n > 16
  ? { n, id: `lib-${n}`, kind: "library", design: "Library", year: 2024, title: `Hospital Canselor Tuanku Muhriz UKM — Antimicrobial Stewardship and Empirical Therapy Guideline for Adult Inpatients, 4th edition, section ${n}.2.1`, text: "Hydrocortisone 200 mg/day by infusion for 4 to 7 days may be considered in severe CAP admitted to ICU, after discussion with the ICU consultant on call.", documentId: `doc-${n}`, section: `${n}.2.1` }
  : { n, id: `pmid:${38_000_000 + n}`, kind: "study", design: DESIGNS[n % DESIGNS.length]!, year: 2025 - n, from: "The Cochrane Database of Systematic Reviews", title: n === 1 ? TITLE : `${TITLE.slice(0, 120 + n * 9)} (${n})`, text: "In 7,284 participants across 16 trials, corticosteroids reduced 30-day mortality in severe CAP (RR 0.62, 95% CI 0.45 to 0.85) but not in non-severe disease; hyperglycaemia needing insulin was more common.", url: `https://pubmed.ncbi.nlm.nih.gov/${38_000_000 + n}/`, pmid: String(38_000_000 + n) };
const claim = (i: number): Claim => ({
  text: i === 0
    ? "In adults with severe community-acquired pneumonia admitted to intensive care, a short course of hydrocortisone started within 24 hours reduced 28-day mortality, with the largest benefit in those needing high-flow oxygen or non-invasive ventilation; it did not reduce mortality in patients already on vasopressors."
    : i === 1 ? "Not in mild CAP." : `Claim ${i + 1}: hyperglycaemia and secondary infection were more frequent with steroids, so check capillary glucose every 6 hours during treatment.`,
  // Claim 1 rests on every source; most rest on two or three.
  cites: i === 0 ? Array.from({ length: 20 }, (_, n) => n + 1) : [...new Set([((i * 3) % 20) + 1, ((i * 7) % 20) + 1])], // the router deduplicates (sourcedClaims)
});

const answerOf = (question: string, claims: Claim[], references: Reference[], extra: Partial<Answer> = {}) => ({
  question, bottomLine: claims.length ? "Not routinely: give hydrocortisone only in severe pneumonia treated in intensive care, within 24 hours of admission." : undefined,
  claims, enough: claims.length > 0, general: undefined, followUps: claims.length ? ["Which steroid and what dose in severe community-acquired pneumonia requiring ICU admission?", "Do steroids help in influenza pneumonia?", "When should steroids be stopped?"] : [],
  source: "medgemma-27b", references, pubmed: "ok", curb65: null, ...extra,
}) as Answer;

/** The stream as the router sends it: search, read (with every source), write, each claim, then the answer. */
async function* streamOf(answer: Answer): AsyncGenerator<StreamEvent> {
  yield { type: "step", step: "search" };
  const studies = answer.references.filter(r => r.kind === "study").length;
  yield { type: "step", step: "read", studies, passages: answer.references.length - studies, references: answer.references };
  yield { type: "step", step: "write" };
  for (const c of answer.claims) yield { type: "claim", claim: c };
  yield { type: "answer", answer };
}
const asked = (make: (question: string) => Answer) => (input: { question: string }) => streamOf(make(input.question)) as never;
const all = <T,>(n: number, of: (i: number) => T) => Array.from({ length: n }, (_, i) => of(i));

export default [
  fixture("evidence.stream", {
    worst: asked(q => answerOf(q, all(12, claim), all(20, i => reference(i + 1)), { cutShort: true } as Partial<Answer>)),
    // Nothing found and nothing said: PubMed unreachable, no library passage, the model's general knowledge only.
    empty: asked(q => answerOf(q, [], [], { pubmed: "unavailable", general: "Steroids are not part of routine treatment for pneumonia." } as Partial<Answer>)),
    one: asked(q => answerOf(q, [{ text: "Not in mild CAP.", cites: [1] }], [reference(1)])),
  }),
];
