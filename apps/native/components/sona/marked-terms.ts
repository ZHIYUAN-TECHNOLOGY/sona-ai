/**
 * Which words in clinical text get a colour, so the eye lands on what matters first:
 * alert (red) for what must not be missed (allergies, severe or critical findings, abnormal
 * results), medicine (violet), finding (teal) for diagnoses and signs, symptom (blue), and
 * caution (amber) for what is unconfirmed or still open. Terms come from explicit
 * `[[text|kind]]` markup (what a model response would emit) or this dictionary.
 *
 * ponytail: dictionary matching is a stand-in; the backend should emit markup once responses are
 * generated. Longer phrases are listed before the words inside them so they win.
 */
export type Mark = "alert" | "medicine" | "finding" | "symptom" | "caution";
const MARKS = "alert|medicine|finding|symptom|caution";

const words = (list: string[]) => new RegExp(`\\b(?:${list.join("|")})\\b`, "gi");
const DICTIONARY: [RegExp, Mark][] = [
  [words([
    "(?:penicillin|drug|sulfa) allerg(?:y|ic)", "allerg(?:y|ic) to \\w+", "anaphylaxis", "septic shock", "sepsis",
    "(?<!non-)severe(?: pneumonia)?", "critical", "intensive care", "hyperglycaemia", "high blood sugar", "hypokalaemia",
    // An abnormal result names its analyte, so "low risk" or "high certainty" never turns red.
    "(?:low|high) (?:potassium|sodium|haemoglobin|hb|glucose)", "(?:potassium|sodium|haemoglobin|hb|glucose) (?:is )?(?:low|high)",
  ]), "alert"],
  [words([
    "azithromycin", "amoxicillin", "co-amoxiclav", "ceftriaxone", "penicillin", "paracetamol", "salbutamol", "albuterol", "cetirizine",
    "prednisolone", "prednisone", "hydrocortisone", "corticosteroids?", "steroids?", "furosemide", "metformin", "insulin",
    "magnesium sulphate", "magnesium", "beta-blockers?", "antibiotics?", "inhaler", "nebulised salbutamol",
  ]), "medicine"],
  [words([
    "community-acquired pneumonia", "pneumonia", "consolidation", "asthma", "copd", "pyelonephritis", "cellulitis", "appendicitis",
    "peritonitis", "heart failure", "chronic kidney disease", "kidney disease", "acute kidney injury", "ischaemic stroke", "stroke",
    "infarct", "anaemia", "hyponatraemia", "type 2 diabetes", "diabetes", "hypertension", "atrial fibrillation", "curb-65 \\d",
    "respiratory review",
  ]), "finding"],
  [words([
    "shortness of breath", "chest pain", "breathlessness", "cough", "fever", "wheeze", "wheezing", "rash", "vomiting", "confusion", "pain",
  ]), "symptom"],
  [words([
    "unconfirmed", "not confirmed", "needs confirmation", "not yet documented", "not documented", "not stated", "not described",
    "missing", "unknown", "blocked", "pending", "interrupted", "allerg(?:y|ic)",
  ]), "caution"],
];

export type Segment = { text: string; mark?: Mark };
export function segments(input: string): Segment[] {
  const out: Segment[] = [];
  const markup = new RegExp(`\\[\\[(.+?)\\|(${MARKS})\\]\\]`, "g");
  let last = 0;
  const plain = (text: string) => {
    const hits: { start: number; end: number; mark: Mark }[] = [];
    // Categories in order, and within one the longest match first, so an earlier or longer term wins an overlap.
    for (const [pattern, mark] of DICTIONARY) {
      const found = [...text.matchAll(pattern)].sort((a, b) => b[0].length - a[0].length);
      for (const m of found) {
        const start = m.index!, end = start + m[0].length;
        if (!hits.some(h => start < h.end && end > h.start)) hits.push({ start, end, mark });
      }
    }
    hits.sort((a, b) => a.start - b.start);
    let at = 0;
    for (const h of hits) { if (h.start > at) out.push({ text: text.slice(at, h.start) }); out.push({ text: text.slice(h.start, h.end), mark: h.mark }); at = h.end; }
    if (at < text.length) out.push({ text: text.slice(at) });
  };
  for (const m of input.matchAll(markup)) { plain(input.slice(last, m.index)); out.push({ text: m[1]!, mark: m[2] as Mark }); last = m.index! + m[0].length; }
  plain(input.slice(last));
  return out;
}

/** Words as MarkedText counts them (segment-aware), for driving `shown` while streaming. */
export const wordCount = (text: string) => segments(text).reduce((n, seg) => n + seg.text.split(/\s+/).filter(Boolean).length, 0);
