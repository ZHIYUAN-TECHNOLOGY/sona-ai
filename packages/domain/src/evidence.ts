import type { Patient } from "./types";

/**
 * Evidence answer: a graded three-line answer, the studies behind it, and the severity score that
 * decides which evidence applies to this patient.
 *
 * ponytail: authored summaries of real, well-known publications; links open a PubMed search, not a
 * retrieved record. Retrieval, grading rules and synthesis arrive with the backend (see the plan).
 */
export type Study = { id: string; kind: "Guideline" | "Trial" | "Review"; year: number; title: string; finding: string; query: string };
export type Factor = { id: string; label: string; value?: string; rule: string; point?: boolean };

export const GRADE = { certainty: "High certainty", direction: "Against routine use", scope: "non-severe pneumonia" };
export const ANSWER = [
  "No routine steroids for non-severe community-acquired pneumonia.",
  "Consider them only for severe pneumonia, septic shock, or another indication such as an asthma flare.",
  "They shorten time to stability a little but raise blood glucose; no mortality benefit outside severe cases.",
];
export const STUDIES: Study[] = [
  { id: "ats-idsa", kind: "Guideline", year: 2019, title: "ATS/IDSA adult CAP guideline", finding: "Recommends against routine corticosteroids in non-severe pneumonia.", query: "Metlay 2019 community-acquired pneumonia ATS IDSA guideline" },
  { id: "blum", kind: "Trial", year: 2015, title: "Prednisone in CAP (Lancet)", finding: "A week of prednisone reached stability about a day sooner, with more high blood sugar and no mortality difference.", query: "Blum 2015 prednisone community-acquired pneumonia Lancet" },
  { id: "cape-cod", kind: "Trial", year: 2023, title: "Hydrocortisone in severe CAP (NEJM)", finding: "Lower 28-day mortality, but only in severe pneumonia treated in intensive care.", query: "Dequin 2023 hydrocortisone severe community-acquired pneumonia" },
];
export const pubmedUrl = (s: Study) => `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(s.query)}`;

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
  const recorded = factors.filter(f => f.point !== undefined).length;
  const score = factors.filter(f => f.point).length;
  const risk = recorded < factors.length ? undefined : score <= 1 ? "Low risk · home treatment is usually suitable" : score === 2 ? "Moderate risk · consider admission" : "High risk · manage as severe";
  return { factors, score, recorded, risk };
}
