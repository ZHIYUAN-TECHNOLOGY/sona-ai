/**
 * Which words in clinical text get a colour, so the eye lands on what matters first:
 * alert (red) for what must not be missed (allergies, severe or critical findings, abnormal
 * results), medicine (violet), finding (teal) for diagnoses and signs, symptom (blue), and
 * caution (amber) for what is unconfirmed or still open, and for a measurement out of range. Terms come from explicit
 * `[[text|kind]]` markup (what a model response would emit) or, when a text has none, this dictionary.
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
    "respiratory review", "\\d+(?:\\.\\d+)? mm nodule", "nodule", "borderline heart size", "heart size", "cardiomegaly", "pleural effusion", "effusion",
  ]), "finding"],
  [words([
    "shortness of breath", "chest pain", "breathlessness", "cough", "fever", "wheeze", "wheezing", "rash", "vomiting", "confusion", "pain",
  ]), "symptom"],
  [words([
    "unconfirmed", "not confirmed", "needs confirmation", "not yet documented", "not documented", "not stated", "not described",
    "missing", "unknown", "blocked", "pending", "interrupted", "allerg(?:y|ic)",
  ]), "caution"],
];

/**
 * A measurement outside its usual adult range, marked with its number and unit: amber outside [low, high],
 * red outside [criticalLow, criticalHigh]. A value in range stays plain, so the colour keeps its meaning.
 * ponytail: fixed adult ranges, a stand-in until results arrive with their own reference ranges and flags.
 */
const VITALS: [label: string, unit: string, low: number, high: number, criticalLow: number, criticalHigh: number][] = [
  ["temperature|temp", "\\s?°C", 36, 37.9, 35, 38.9],
  ["oxygen saturation|spo2|sats", "\\s?%", 94, 100, 92, 100],
  ["pulse|heart rate", "\\s?(?:bpm|/min)", 50, 100, 40, 119],
  ["respiratory rate", "\\s?/min", 12, 20, 9, 24],
  ["systolic", "\\s?mmHg", 100, 139, 90, 179],
  ["diastolic", "\\s?mmHg", 60, 89, 50, 109],
];
const MEASURED = VITALS.map(([label, unit, ...range]) => [new RegExp(`\\b(?:${label})(?: is| of|:)? (\\d+(?:\\.\\d+)?)(?:${unit})?`, "gi"), range] as const);

const NEGATED_BEFORE = /\b(?:no|denies|denied|without|nil)\s+$/i;
// A full mental test score (AMT 8 to 10 of 10) is the same as "absent".
const NEGATED_AFTER = /^\s+(?:absent|not present|denied|resolved|AMT (?:8|9|10)\/10)\b/i;

export type Segment = { text: string; mark?: Mark };
export function segments(input: string): Segment[] {
  const out: Segment[] = [];
  const markup = new RegExp(`\\[\\[(.+?)\\|(${MARKS})\\]\\]`, "g");
  let last = 0;
  const plain = (text: string) => {
    const hits: { start: number; end: number; mark: Mark }[] = [];
    for (const [pattern, [low, high, criticalLow, criticalHigh]] of MEASURED) for (const m of text.matchAll(pattern)) {
      const value = Number(m[1]);
      if (value < low || value > high) hits.push({ start: m.index!, end: m.index! + m[0].length, mark: value < criticalLow || value > criticalHigh ? "alert" : "caution" });
    }
    // Categories in order, and within one the longest match first, so an earlier or longer term wins an overlap.
    for (const [pattern, mark] of DICTIONARY) {
      const found = [...text.matchAll(pattern)].sort((a, b) => b[0].length - a[0].length);
      for (const m of found) {
        const start = m.index!, end = start + m[0].length;
        // A symptom the note says is absent ("no fever", "confusion absent") is not a finding to look at.
        if (mark === "symptom" && (NEGATED_BEFORE.test(text.slice(0, start)) || NEGATED_AFTER.test(text.slice(end)))) continue;
        if (!hits.some(h => start < h.end && end > h.start)) hits.push({ start, end, mark });
      }
    }
    hits.sort((a, b) => a.start - b.start);
    let at = 0;
    for (const h of hits) { if (h.start > at) out.push({ text: text.slice(at, h.start) }); out.push({ text: text.slice(h.start, h.end), mark: h.mark }); at = h.end; }
    if (at < text.length) out.push({ text: text.slice(at) });
  };
  // Text with explicit markup says what matters itself: the dictionary stays off, so only those terms are coloured.
  const explicit = [...input.matchAll(markup)];
  const rest = explicit.length ? (text: string) => { if (text) out.push({ text }); } : plain;
  for (const m of explicit) { rest(input.slice(last, m.index)); out.push({ text: m[1]!, mark: m[2] as Mark }); last = m.index! + m[0].length; }
  rest(input.slice(last));
  return out;
}

/** Words as MarkedText counts them (segment-aware), for driving `shown` while streaming. */
export const wordCount = (text: string) => segments(text).reduce((n, seg) => n + seg.text.split(/\s+/).filter(Boolean).length, 0);
