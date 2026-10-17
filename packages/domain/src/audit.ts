import { DEMO_PATIENT } from "./ward";
import type { Encounter } from "./types";

/**
 * Last night's coding audit: notes whose wording is too vague for the most specific code, each
 * with the claim or casemix value at risk and a drafted query to the doctor who wrote it. Sending a
 * query clears the row; the demo patient's row clears itself once flow 2 documents the organism.
 *
 * ponytail: authored audit items. A model plus terminology lookup finds the gaps later; queries go
 * through tasks.
 */
/** `from` is empty when the diagnosis is not coded at all yet. */
export type AuditItem = { id: string; bed: string; patient: string; doctor: string; gap: string; from: string; to: string; risk: number; query: string };

const ITEMS: AuditItem[] = [
  { id: "a-amelia", bed: "Bed 6", patient: "Amelia Tan", doctor: "Dr Aisyah", gap: "Pneumonia: organism not stated", from: "J18.9", to: "J18.9 confirmed", risk: 1420, query: "Could you state in Amelia’s note that the organism is unknown (no sputum sent)? The insurer rejects J18.9 without it." },
  { id: "a-nurul", bed: "Bed 2", patient: "Nurul Huda", doctor: "Dr Lee", gap: "Pyelonephritis: organism in the lab, not the note", from: "N10", to: "N10 + B96.2", risk: 1860, query: "Nurul’s urine culture grew E. coli on 24 Sep. Could you add it to the note so it can be coded?" },
  { id: "a-lim", bed: "Bed 14", patient: "Lim Wei Jie", doctor: "Dr Kumar", gap: "Appendicitis: peritonitis not described", from: "K35.8", to: "K35.3", risk: 2340, query: "The operation note mentions localised pus. Could you confirm localised peritonitis in Lim’s discharge note?" },
  { id: "a-ravi", bed: "Bed 9", patient: "Ravi Kumar", doctor: "Dr Aisyah", gap: "Heart failure: type not stated", from: "I50.9", to: "I50.0", risk: 2110, query: "Could you state the type of heart failure for Ravi (congestive, left ventricular)? The echo report supports it." },
  { id: "a-tan", bed: "Bed 4", patient: "Tan Ah Kow", doctor: "Dr Lee", gap: "Stroke: infarct or bleed not stated", from: "I64", to: "I63.9", risk: 3050, query: "The CT shows an infarct. Could you write “ischaemic stroke” in Tan’s note so it codes as I63?" },
  { id: "a-priya", bed: "Bed 8", patient: "Priya Nair", doctor: "Dr Tan", gap: "Cellulitis: site not specific", from: "L03.9", to: "L03.1", risk: 780, query: "Could you name the limb in Priya’s cellulitis diagnosis (left lower leg)?" },
  { id: "a-siti", bed: "Bed 12", patient: "Siti Aminah", doctor: "Dr Kumar", gap: "Anaemia in the labs, not the note", from: "", to: "D64.9", risk: 640, query: "Siti’s haemoglobin is 9.8 g/dL. Is anaemia a diagnosis you want recorded?" },
  { id: "a-ahmad", bed: "Bed 15", patient: "Ahmad Faizal", doctor: "Dr Tan", gap: "COPD: exacerbation not stated", from: "J44.9", to: "J44.1", risk: 1280, query: "Ahmad was admitted for worsening breathlessness. Could you record it as an acute exacerbation of COPD?" },
  { id: "a-wong", bed: "Bed 17", patient: "Wong Mei Ling", doctor: "Dr Lee", gap: "Hyponatraemia treated, not recorded", from: "", to: "E87.1", risk: 960, query: "Sodium was 126 and corrected with fluid restriction. Could you add hyponatraemia to Mei Ling’s diagnoses?" },
  { id: "a-rajesh", bed: "Bed 21", patient: "Rajesh Pillai", doctor: "Dr Aisyah", gap: "Acute kidney injury in the labs only", from: "", to: "N17.9", risk: 1510, query: "Creatinine doubled on day 2. Is acute kidney injury a diagnosis for Rajesh?" },
  { id: "a-chong", bed: "Bed 22", patient: "Chong Wei", doctor: "Dr Kumar", gap: "Sepsis: organism not linked", from: "A41.9", to: "A41.5", risk: 2090, query: "Blood cultures grew Klebsiella. Could you link the organism to Chong’s sepsis diagnosis?" },
  { id: "a-farah", bed: "Bed 25", patient: "Farah Nadia", doctor: "Dr Tan", gap: "Asthma: acute severe attack not stated", from: "J45.9", to: "J46", risk: 1190, query: "Farah needed magnesium and HDU care. Could you record acute severe asthma?" },
];

export type LabFact = { test: string; value: string; unit?: string | null; sourceId: string };
export type Casemix = Record<string, { weight: number; baseRateCents: number }>;
/** A gap in the shape of an audit_items row; riskCents is the code's casemix weight × base rate. */
export type CodingGap = { gap: string; fromCode: null; toCode: string; riskCents: number; sourceId: string; query: string };

// ponytail: two lab-only diagnoses with adult thresholds; add rules as the audit meets them. Vague
// wording ("organism not stated") needs the model and arrives through the coding tool, not here.
const LAB_RULES = [
  { test: /^(hb|ha?emoglobin)$/i, unit: "g/dL", abnormal: (v: number) => v < 12, term: "anaemia", inNote: /an(a)?emi/i, coded: /^D(5\d|6[0-4])/, code: "D64.9" },
  { test: /^(na|sodium)$/i, unit: "mmol/L", abnormal: (v: number) => v < 135, term: "hyponatraemia", inNote: /hyponatr(a)?emi/i, coded: /^E87\.1/, code: "E87.1" },
];

/** Diagnoses the labs show but neither the note nor the current codes record, one per rule. */
export function codingGaps(input: { sentences: { id: string; text: string }[]; labs: LabFact[]; codes: string[] }, casemix: Casemix): CodingGap[] {
  return LAB_RULES.flatMap(rule => {
    const lab = input.labs.find(l => rule.test.test(l.test) && l.unit === rule.unit && rule.abnormal(Number(l.value)));
    if (!lab || input.sentences.some(s => rule.inNote.test(s.text)) || input.codes.some(c => rule.coded.test(c))) return [];
    const price = casemix[rule.code];
    const term = rule.term[0]!.toUpperCase() + rule.term.slice(1);
    return [{
      gap: `${term} in the labs, not the note`, fromCode: null, toCode: rule.code, riskCents: price ? Math.round(price.weight * price.baseRateCents) : 0, sourceId: lab.sourceId,
      query: `${lab.test} is ${lab.value} ${rule.unit}. Is ${rule.term} a diagnosis you want recorded?`,
    }];
  });
}

/** Open audit items: not yet queried, and the demo patient's only while flow 2 has not fixed her note. */
export function openItems(encounters: Record<string, Encounter | undefined>, done: Set<string>): AuditItem[] {
  const fixed = Boolean(encounters[DEMO_PATIENT]?.claim?.organismConfirmed);
  return ITEMS.filter(i => !done.has(i.id) && !(i.id === "a-amelia" && fixed));
}
export const totalRisk = (items: AuditItem[]) => items.reduce((sum, i) => sum + i.risk, 0);
export const formatRM = (n: number) => `RM ${n.toLocaleString("en-MY")}`;
export const shortRM = (n: number) => n < 1000 ? formatRM(n) : `RM ${Math.round(n / 1000)}k`;
