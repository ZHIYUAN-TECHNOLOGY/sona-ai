// Lightweight document-type classifier for scanned clinical paperwork. Pure keyword
// heuristics — no model, no download, instant. Drives the review screen's type pill,
// the document title, and the summary prompt's framing. Deliberately coarse: the
// clinician sees and can ignore it; nothing downstream depends on it being right.

export type DocType = "referral" | "lab-result" | "prescription" | "discharge" | "other";

export interface DocTypeResult {
  type: DocType;
  /** Human label for pills/titles, e.g. "Lab result". */
  label: string;
}

const LABELS: Record<DocType, string> = {
  referral: "Referral letter",
  "lab-result": "Lab result",
  prescription: "Prescription",
  discharge: "Discharge summary",
  other: "Document",
};

// Each rule = distinctive phrases (checked case-insensitively). Scored by hit count;
// highest score wins, ties broken by rule order (more specific first). Includes Malay
// terms — Malaysian clinic paperwork is routinely bilingual.
const RULES: { type: DocType; words: RegExp[] }[] = [
  {
    type: "lab-result",
    words: [
      /\blab(?:oratory)? (?:result|report|test)/i,
      /\b(?:haemoglobin|hemoglobin|hba1c|creatinine|cholesterol|triglycerides|platelet)/i,
      /\breference (?:range|interval)/i,
      /\b(?:mmol\/L|mg\/dL|g\/dL|x10\^?9\/L)\b/i,
      /\bspecimen\b/i,
      /\bkeputusan makmal\b/i,
    ],
  },
  {
    type: "prescription",
    words: [
      /\bprescription\b/i,
      /\bRx\b/,
      /\b(?:tablet|capsule|syrup)s?\b/i,
      /\b(?:od|bd|tds|qid|prn|stat)\b/i,
      /\b\d+\s*(?:mg|mcg|ml)\b/i,
      /\bpreskripsi|ubat\b/i,
    ],
  },
  {
    type: "discharge",
    words: [
      /\bdischarge (?:summary|note|advice)\b/i,
      /\bdate of (?:admission|discharge)\b/i,
      /\bward\b/i,
      /\bringkasan discaj\b/i,
    ],
  },
  {
    type: "referral",
    words: [
      /\breferral\b/i,
      /\brefer(?:red|ring)? to\b/i,
      /\bdear (?:dr|doctor|colleague)/i,
      /\bthank you for seeing\b/i,
      /\bsurat rujukan\b/i,
    ],
  },
];

/** Classify OCR'd document text by keyword score. Falls back to "other". */
export function classifyDocType(text: string): DocTypeResult {
  let best: DocType = "other";
  let bestScore = 0;
  for (const rule of RULES) {
    const score = rule.words.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
    if (score > bestScore) {
      best = rule.type;
      bestScore = score;
    }
  }
  // One weak hit (e.g. the lone word "ward") is noise — require 2+ to claim a type.
  if (bestScore < 2) best = "other";
  return { type: best, label: LABELS[best] };
}
