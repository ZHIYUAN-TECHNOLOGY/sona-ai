import type { Patient } from "./types";

/**
 * Evidence answer: a graded three-line answer, the studies behind it, and the severity score that
 * decides which evidence applies to this patient.
 *
 * ponytail: authored summaries of real, well-known publications, each linked to its PubMed record
 * (PMIDs checked against PubMed). Retrieval, grading rules and synthesis arrive with the backend (see the plan).
 */
export type StudyKind = "Guideline" | "Review" | "Trial" | "Narrative review" | "Study";
export type Study = { id: string; kind: StudyKind; year: number; title: string; finding: string; query: string; pmid?: string; journal?: string };
export type Factor = { id: string; label: string; value?: string; rule: string; point?: boolean };

export const GRADE = { certainty: "High certainty", direction: "Against routine use", scope: "non-severe pneumonia" };
export const ANSWER = [
  "No routine steroids for non-severe community-acquired pneumonia.",
  "Consider them only for severe pneumonia, septic shock, or another indication such as an asthma flare.",
  "They shorten time to stability a little but raise blood glucose; no mortality benefit outside severe cases.",
];
export const STUDIES: Study[] = [
  { id: "ats-idsa", pmid: "31573350", kind: "Guideline", year: 2019, title: "ATS/IDSA adult CAP guideline", finding: "Recommends against routine corticosteroids in non-severe pneumonia.", query: "Metlay 2019 community-acquired pneumonia ATS IDSA guideline" },
  { id: "blum", pmid: "25608756", kind: "Trial", year: 2015, title: "Prednisone in CAP (Lancet)", finding: "A week of prednisone reached stability about a day sooner, with more high blood sugar and no mortality difference.", query: "Blum 2015 prednisone community-acquired pneumonia Lancet" },
  { id: "cape-cod", pmid: "36942789", kind: "Trial", year: 2023, title: "Hydrocortisone in severe CAP (NEJM)", finding: "Lower 28-day mortality, but only in severe pneumonia treated in intensive care.", query: "Dequin 2023 hydrocortisone severe community-acquired pneumonia" },
];
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

/**
 * The certainty label, by rule on the strongest design cited (GRADE's starting levels, simplified):
 * a guideline or systematic review is high, a randomised trial moderate, anything else low.
 * ponytail: starting level only; downgrading for bias, inconsistency or indirectness needs a reviewer.
 */
export function certaintyOf(kinds: StudyKind[]) {
  if (!kinds.length) return "No evidence found";
  if (kinds.some(k => k === "Guideline" || k === "Review")) return "High certainty";
  if (kinds.includes("Trial")) return "Moderate certainty";
  return "Low certainty";
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
