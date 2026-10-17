import { MARK_KINDS, markKindOf, type MarkKind, type Mark as Term } from "@sona-ai/domain/answer-parts";

/**
 * Which words in clinical text get a colour, so the eye lands on what matters first, by the kinds every Sona surface
 * shares (@sona-ai/domain/answer-parts): warning (red) for what must not be missed (allergies, severe or critical
 * findings, abnormal results), medicine (blue), condition and symptom (teal), caution (amber) for what is unconfirmed or
 * still open, and for a measurement out of range; a model also marks dose (violet) and test (ink). Terms come from the
 * model's marks (`terms`), explicit `[[text|kind]]` markup (old names too: alert, finding) or, when a text has neither,
 * this dictionary.
 *
 * ponytail: dictionary matching is a stand-in for text no model marked. Longer phrases are listed before the words
 * inside them so they win.
 */
export type Mark = MarkKind;
const MARKS = [...MARK_KINDS, "alert", "finding", "when"].join("|");

const words = (list: string[]) => new RegExp(`\\b(?:${list.join("|")})\\b`, "gi");
const DICTIONARY: [RegExp, Mark][] = [
  [words([
    "(?:penicillin|drug|sulfa) allerg(?:y|ic)", "allerg(?:y|ic) to \\w+", "anaphylaxis", "septic shock", "sepsis",
    "(?<!non-)severe(?: pneumonia)?", "critical", "lips (?:turn(?:ing)? )?(?:bluish|blue)", "bluish lips", "straight to emergency", "intensive care", "hyperglycaemia", "high blood sugar", "hypokalaemia",
    // An abnormal result names its analyte, so "low risk" or "high certainty" never turns red.
    "(?:low|high) (?:potassium|sodium|haemoglobin|hb|glucose)", "(?:potassium|sodium|haemoglobin|hb|glucose) (?:is )?(?:low|high)",
  ]), "warning"],
  [words([
    "azithromycin", "amoxicillin", "co-amoxiclav", "ceftriaxone", "penicillin", "paracetamol", "salbutamol", "albuterol", "cetirizine",
    "prednisolone", "prednisone", "hydrocortisone", "corticosteroids?", "steroids?", "furosemide", "metformin", "insulin",
    "magnesium sulphate", "magnesium", "beta-blockers?", "antibiotics?", "inhaler", "nebulised salbutamol",
  ]), "medicine"],
  [words([
    "community-acquired pneumonia", "pneumonia", "consolidation", "asthma", "copd", "pyelonephritis", "cellulitis", "appendicitis",
    "peritonitis", "heart failure", "chronic kidney disease", "kidney disease", "acute kidney injury", "ischaemic stroke", "stroke",
    "infarct", "reduced air entry", "anaemia", "hyponatraemia", "type 2 diabetes", "diabetes", "hypertension", "atrial fibrillation", "curb-65 \\d",
    "respiratory review", "\\d+(?:\\.\\d+)? mm nodule", "nodule", "borderline heart size", "heart size", "cardiomegaly", "pleural effusion", "effusion",
  ]), "condition"],
  [words([
    "shortness of breath", "chest pain", "chest tightness", "breathlessness", "breathless", "coughing", "cough", "fever", "phlegm", "sputum", "shivering", "wheeze", "wheezing", "rash", "vomiting", "confusion", "pain",
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
  ["oxygen saturation|saturation|spo2|sats", "\\s?%", 94, 100, 92, 100],
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
type Hit = { start: number; end: number; mark: Mark };
/** `text` cut at its hits, which must not overlap. */
function cut(text: string, hits: Hit[], out: Segment[]) {
  hits.sort((a, b) => a.start - b.start);
  let at = 0;
  for (const h of hits) { if (h.start > at) out.push({ text: text.slice(at, h.start) }); out.push({ text: text.slice(h.start, h.end), mark: h.mark }); at = h.end; }
  if (at < text.length) out.push({ text: text.slice(at) });
}

/**
 * `terms`: the model's marks for this text (ask.free's `marks`), each its first mention not inside a longer one; given,
 * they alone colour it, and none (`[]`) leaves it plain: the model chose to colour nothing.
 */
export function segments(input: string, terms?: Term[]): Segment[] {
  const out: Segment[] = [];
  if (terms) {
    const hits: Hit[] = [];
    for (const t of [...terms].sort((a, b) => b.text.length - a.text.length)) {
      if (!t.text) continue;
      for (let start = input.indexOf(t.text); start >= 0; start = input.indexOf(t.text, start + 1)) {
        const end = start + t.text.length;
        if (!hits.some(h => start < h.end && end > h.start)) { hits.push({ start, end, mark: t.kind }); break; }
      }
    }
    cut(input, hits, out);
    return out;
  }
  const markup = new RegExp(`\\[\\[(.+?)\\|(${MARKS})\\]\\]`, "g");
  let last = 0;
  const plain = (text: string) => {
    const hits: Hit[] = [];
    for (const [pattern, [low, high, criticalLow, criticalHigh]] of MEASURED) for (const m of text.matchAll(pattern)) {
      const value = Number(m[1]);
      if (value < low || value > high) hits.push({ start: m.index!, end: m.index! + m[0].length, mark: value < criticalLow || value > criticalHigh ? "warning" : "caution" });
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
    cut(text, hits, out);
  };
  // Text with explicit markup says what matters itself: the dictionary stays off, so only those terms are coloured.
  const explicit = [...input.matchAll(markup)];
  const rest = explicit.length ? (text: string) => { if (text) out.push({ text }); } : plain;
  for (const m of explicit) { rest(input.slice(last, m.index)); out.push({ text: m[1]!, mark: markKindOf(m[2])! }); last = m.index! + m[0].length; }
  rest(input.slice(last));
  return out;
}

/** Words as MarkedText counts them (segment-aware), for driving `shown` while streaming. */
export const wordCount = (text: string, terms?: Term[]) => segments(text, terms).reduce((n, seg) => n + seg.text.split(/\s+/).filter(Boolean).length, 0);
