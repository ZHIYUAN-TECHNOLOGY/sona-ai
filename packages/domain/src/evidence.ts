import type { Patient } from "./types";

/**
 * Evidence answer, OpenEvidence style (docs/evidence-answer-spec.md): short claims, each citing
 * numbered sources; how strong the evidence is is said in the words and shown as each source's
 * design; one numbered reference list; suggested follow-ups; and the severity score that decides
 * which evidence applies to this patient.
 *
 * ponytail: authored summaries of real, well-known publications, each linked to its PubMed record
 * (PMIDs checked against PubMed). Any other question's claims come from the model seam (a mock until
 * the models are hosted).
 */
export type StudyKind = "Guideline" | "Review" | "Trial" | "Narrative review" | "Study";
export type Study = { id: string; kind: StudyKind; year: number; title: string; finding: string; query: string; pmid?: string; journal?: string };
export type Factor = { id: string; label: string; value?: string; rule: string; point?: boolean };
/** One sentence of an answer and the 1-based numbers of the references behind it. */
export type Claim = { text: string; cites: number[] };
/** One numbered source: PubMed studies first, then library passages. */
export type Reference = {
  n: number; id: string; kind: "study" | "library"; design: StudyKind | "Library"; title: string; year: number; from?: string; text: string;
  url?: string; pmid?: string; documentId?: string; section?: string;
};

export const STUDIES: Study[] = [
  { id: "ats-idsa", pmid: "31573350", kind: "Guideline", year: 2019, title: "ATS/IDSA adult CAP guideline", finding: "Recommends against routine corticosteroids in non-severe pneumonia.", query: "Metlay 2019 community-acquired pneumonia ATS IDSA guideline" },
  { id: "blum", pmid: "25608756", kind: "Trial", year: 2015, title: "Prednisone in CAP (Lancet)", finding: "A week of prednisone reached stability about a day sooner, with more high blood sugar and no mortality difference.", query: "Blum 2015 prednisone community-acquired pneumonia Lancet" },
  { id: "cape-cod", pmid: "36942789", kind: "Trial", year: 2023, title: "Hydrocortisone in severe CAP (NEJM)", finding: "Lower 28-day mortality, but only in severe pneumonia treated in intensive care.", query: "Dequin 2023 hydrocortisone severe community-acquired pneumonia" },
];

/** The rehearsed demo question: steroids for community-acquired pneumonia. Cites number the three STUDIES in order. */
export const isRehearsed = (q: string) => /steroid|prednis|hydrocortisone/i.test(q) && /pneumonia|\bCAP\b/i.test(q);
// Have a clinician check these sentences before a live demo.
export const ANSWER: Claim[] = [
  { text: "Routine corticosteroids are not recommended for non-severe community-acquired pneumonia; the adult guideline advises against them.", cites: [1] },
  { text: "In severe pneumonia treated in intensive care, a large randomised trial found hydrocortisone lowered 28-day mortality, so steroids can be considered there.", cites: [3] },
  { text: "Outside severe cases, a randomised trial found a week of prednisone reached stability about a day sooner but raised blood glucose, with no difference in mortality.", cites: [2, 1] },
];
/** The rehearsed answer's suggested follow-ups, each with its own authored, cited answer. */
export const FOLLOW_UPS: { question: string; claims: Claim[] }[] = [
  { question: "When would steroids be reasonable for her?", claims: [
    { text: "Only if her pneumonia becomes severe enough for intensive care: that is where the randomised trial found hydrocortisone lowered 28-day mortality.", cites: [3] },
    { text: "While it stays non-severe, the guideline advises against routine steroids.", cites: [1] },
  ] },
  { question: "What harms should I watch for?", claims: [
    { text: "High blood glucose: patients given prednisone had it more often, sometimes needing insulin.", cites: [2] },
    { text: "That trial found no difference in mortality, so the harm is not offset by survival outside severe cases.", cites: [2] },
  ] },
  { question: "What dose and duration did the trials use?", claims: [
    { text: "Prednisone 50 mg once daily for 7 days in hospitalised patients.", cites: [2] },
    { text: "Intravenous hydrocortisone 200 mg a day for 4 days, then tapered, for 8 or 14 days in all, in intensive care.", cites: [3] },
  ] },
];

/** The authored answer for the rehearsed question or one of its suggested follow-ups (exact wording); undefined for anything else. */
export function authoredAnswer(question: string): { claims: Claim[]; followUps: string[] } | undefined {
  const q = question.trim();
  const follow = FOLLOW_UPS.find(f => f.question === q);
  if (follow) return { claims: follow.claims, followUps: FOLLOW_UPS.filter(f => f !== follow).map(f => f.question) };
  if (isRehearsed(q)) return { claims: ANSWER, followUps: FOLLOW_UPS.map(f => f.question) };
}

/** The authored studies as numbered references, for the answer shown without the server. */
export const authoredReferences = (): Reference[] => STUDIES.map((s, i) => ({ n: i + 1, id: `pmid:${s.pmid}`, kind: "study", design: s.kind, title: s.title, year: s.year, from: s.journal, text: s.finding, url: pubmedUrl(s), pmid: s.pmid }));

/**
 * No source, no claim: keeps a claim only if it cites at least one of the `count` references, with
 * its numbers deduplicated and any number outside the list dropped, and its text trimmed.
 */
export function sourcedClaims(claims: Claim[], count: number): Claim[] {
  return claims.flatMap(c => {
    const cites = [...new Set(c.cites)].filter(n => Number.isInteger(n) && n >= 1 && n <= count);
    const text = c.text.trim();
    return text && cites.length ? [{ text, cites }] : [];
  });
}

/** A retrieved study opens its own abstract; an authored one opens a PubMed search for it. */
export const pubmedUrl = (s: Pick<Study, "query" | "pmid">) => s.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/` : `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(s.query)}`;

/** A study's design from PubMed's publication types, strongest first. A plain "Review" is narrative, not systematic. */
export function studyKind(publicationTypes: string[]): StudyKind {
  const has = (t: string) => publicationTypes.includes(t);
  if (has("Practice Guideline") || has("Guideline")) return "Guideline";
  if (has("Systematic Review") || has("Meta-Analysis")) return "Review";
  if (has("Randomized Controlled Trial")) return "Trial";
  if (has("Review")) return "Narrative review";
  return "Study";
}

// ponytail: the ward-chart values for the demo patient; a real chart feeds these by source ID.
const CHART: Record<string, { confusion?: string; urea?: number; rr?: number; sbp?: number; dbp?: number }> = {
  "SYN-1042": { confusion: "None (AMT 10/10)", urea: 5.1, rr: 18, sbp: 124, dbp: 78 },
};

/** CURB-65 from what is recorded; an unrecorded factor stays unknown instead of counting as normal. */
export function curb65(patient: Patient): { factors: Factor[]; score: number; recorded: number; risk?: string } {
  const c = CHART[patient.id] ?? {};
  const factors: Factor[] = [
    { id: "c", label: "Confusion", value: c.confusion, rule: "new confusion", point: c.confusion === undefined ? undefined : !/^none/i.test(c.confusion) },
    { id: "u", label: "Urea", value: c.urea === undefined ? undefined : `${c.urea} mmol/L`, rule: "> 7 mmol/L", point: c.urea === undefined ? undefined : c.urea > 7 },
    { id: "r", label: "Respiratory rate", value: c.rr === undefined ? undefined : `${c.rr} /min`, rule: "≥ 30 /min", point: c.rr === undefined ? undefined : c.rr >= 30 },
    { id: "b", label: "Blood pressure", value: c.sbp === undefined ? undefined : `${c.sbp}/${c.dbp}`, rule: "< 90 systolic or ≤ 60 diastolic", point: c.sbp === undefined ? undefined : c.sbp < 90 || (c.dbp ?? 99) <= 60 },
    { id: "a", label: "Age", value: `${patient.age}`, rule: "≥ 65", point: patient.age >= 65 },
  ];
  return scored(factors);
}

/** Score and band; the band is withheld until all five factors are recorded. */
function scored<F extends Factor>(factors: F[]) {
  const recorded = factors.filter(f => f.point !== undefined).length;
  const score = factors.filter(f => f.point).length;
  const risk = recorded < factors.length ? undefined : score <= 1 ? "Low risk · home treatment is usually suitable" : score === 2 ? "Moderate risk · consider admission" : "High risk · manage as severe";
  return { factors, score, recorded, risk };
}

/** An observations row; structurally the `Observation` contract in @sona-ai/api. */
export type ObservationRow = { kind: "confusion" | "urea" | "respiratory-rate" | "systolic" | "diastolic"; value: number; unit: string; sourceId: string };

/**
 * CURB-65 from observation rows plus age, each factor citing the readings behind it. The last row of
 * a kind wins (pass them oldest first). A reading in an unexpected unit counts as unrecorded rather
 * than being misread. Confusion is the abbreviated mental test: 8 or less out of 10 scores.
 */
export function curb65FromObservations(observations: ObservationRow[], age: number) {
  const units = { confusion: "AMT", urea: "mmol/L", "respiratory-rate": "/min", systolic: "mmHg", diastolic: "mmHg" } as const;
  const read = (kind: ObservationRow["kind"]) => observations.findLast(o => o.kind === kind && o.unit === units[kind]);
  const c = read("confusion"), u = read("urea"), r = read("respiratory-rate"), s = read("systolic"), d = read("diastolic");
  const sources = (...rows: (ObservationRow | undefined)[]) => rows.flatMap(o => (o ? [o.sourceId] : []));
  const lowBp = (s && s.value < 90) || (d && d.value <= 60);
  const factors: (Factor & { sources: string[] })[] = [
    { id: "c", label: "Confusion", value: c && `AMT ${c.value}/10`, rule: "new confusion", point: c && c.value <= 8, sources: sources(c) },
    { id: "u", label: "Urea", value: u && `${u.value} mmol/L`, rule: "> 7 mmol/L", point: u && u.value > 7, sources: sources(u) },
    { id: "r", label: "Respiratory rate", value: r && `${r.value} /min`, rule: "≥ 30 /min", point: r && r.value >= 30, sources: sources(r) },
    { id: "b", label: "Blood pressure", value: s || d ? `${s?.value ?? "–"}/${d?.value ?? "–"} mmHg` : undefined, rule: "< 90 systolic or ≤ 60 diastolic", point: lowBp ? true : s && d ? false : undefined, sources: sources(s, d) },
    { id: "a", label: "Age", value: `${age}`, rule: "≥ 65", point: age >= 65, sources: [] },
  ];
  return scored(factors);
}
