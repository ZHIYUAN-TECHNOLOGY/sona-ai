import { ingest, search, type Embedder, type LibraryDocument, type Reranker } from "./retrieval";

type Db = Parameters<typeof ingest>[0];

/**
 * SYNTHETIC mini-corpus for the retrieval eval. Authored for testing only: not clinical guidance, not
 * quoted from any guideline or policy. The 30-question set replaces it once the real corpus is licensed.
 */
export const SYNTHETIC_CORPUS: { doc: LibraryDocument; text: string }[] = [
  {
    doc: { id: "synth-cap-steroids", hospitalId: null, title: "Corticosteroids in pneumonia (SYNTHETIC)", source: "Synthetic CAP guideline", year: 2026 },
    text: `# Non-severe pneumonia
Do not routinely give corticosteroids (steroids) to adults with non-severe community-acquired pneumonia; no mortality benefit is shown.

# Severe pneumonia
Consider hydrocortisone for severe community-acquired pneumonia needing intensive care, weighing hyperglycaemia and secondary infection.

# Refractory septic shock
In pneumonia with septic shock not responding to fluids and vasopressors, steroids follow the sepsis protocol.`,
  },
  {
    doc: { id: "synth-curb65", hospitalId: null, title: "CURB-65 severity score (SYNTHETIC)", source: "Synthetic severity handbook", year: 2025 },
    text: `1. Criteria
One point each for confusion, urea above 7 mmol/L, respiratory rate 30 or more, low blood pressure (systolic below 90 or diastolic 60 or less) and age 65 or over.

2. Risk bands
A CURB-65 score of 0 to 1 is low risk and suits home treatment; 2 is moderate risk; 3 or more is high risk and needs admission, considering ICU at 4 to 5.

3. Missing values
When urea or another factor is not recorded, report the score as incomplete rather than counting the factor as zero.`,
  },
  {
    doc: { id: "synth-azithro", hospitalId: null, title: "Azithromycin dosing (SYNTHETIC)", source: "Synthetic formulary", year: 2026 },
    text: `# Adult dosing
Azithromycin 500 mg orally once daily for three days for atypical cover in community-acquired pneumonia.

# Renal and hepatic impairment
No azithromycin dose adjustment in mild to moderate kidney impairment; avoid in severe liver disease.

# QT prolongation
Azithromycin can prolong the QT interval; check an ECG and avoid combining with other QT-prolonging drugs.`,
  },
  {
    doc: { id: "synth-gl-policy", hospitalId: null, title: "Guarantee letter criteria (SYNTHETIC)", source: "Synthetic insurer policy", year: 2026 },
    text: `# Eligibility
A guarantee letter covers inpatient admission when the diagnosis is within the policy and the admission is medically necessary.

# Documents required
Submit the admission note, the ICD-10 diagnosis codes, the cost estimate and the attending doctor's signature with the guarantee letter request.

# Turnaround
The insurer answers a complete guarantee letter request within four working hours; an incomplete one is returned for missing documents.`,
  },
];

/** Paraphrased questions with the section that answers them. */
export const EVAL_QUESTIONS: { question: string; expected: string }[] = [
  { question: "Should steroids be given in mild pneumonia?", expected: "synth-cap-steroids#non-severe-pneumonia" },
  { question: "Hydrocortisone for ICU pneumonia patients", expected: "synth-cap-steroids#severe-pneumonia" },
  { question: "What counts toward the CURB-65 score?", expected: "synth-curb65#1-criteria" },
  { question: "CURB-65 of 3 means admit?", expected: "synth-curb65#2-risk-bands" },
  { question: "urea not recorded, how to score", expected: "synth-curb65#3-missing-values" },
  { question: "azithromycin dose for adults with pneumonia", expected: "synth-azithro#adult-dosing" },
  { question: "does azithromycin need adjusting in kidney impairment", expected: "synth-azithro#renal-and-hepatic-impairment" },
  { question: "azithromycin ECG QT risk", expected: "synth-azithro#qt-prolongation" },
  { question: "what documents does a guarantee letter request need", expected: "synth-gl-policy#documents-required" },
  { question: "how long does the insurer take to answer a guarantee letter", expected: "synth-gl-policy#turnaround" },
];

/** The same questions as clinicians here might ask them in Malay and in Chinese, in the same order (30 in all). */
const MALAY = [
  "Perlukah steroid diberi untuk pneumonia ringan?",
  "Hidrokortison untuk pesakit pneumonia di ICU",
  "Apakah kriteria yang dikira dalam skor CURB-65?",
  "Skor CURB-65 sebanyak 3, perlu dimasukkan ke wad?",
  "Urea tidak direkodkan, macam mana nak kira skor?",
  "Dos azithromycin untuk orang dewasa dengan pneumonia",
  "Adakah dos azithromycin perlu diubah untuk pesakit buah pinggang lemah?",
  "Risiko QT azithromycin, perlu buat ECG?",
  "Apakah dokumen yang diperlukan untuk permohonan surat jaminan?",
  "Berapa lama syarikat insurans ambil masa untuk jawab surat jaminan?",
];
const CHINESE = [
  "轻度肺炎需要用类固醇吗？",
  "ICU肺炎患者用氢化可的松",
  "CURB-65评分包括哪些项目？",
  "CURB-65评分3分需要住院吗？",
  "没有记录尿素，怎么评分？",
  "成人肺炎阿奇霉素的剂量",
  "肾功能不全时阿奇霉素需要调整剂量吗？",
  "阿奇霉素的QT间期延长风险，需要做心电图吗？",
  "申请担保信需要哪些文件？",
  "保险公司多久会回复担保信申请？",
];
const sameAnswers = (questions: string[]) => questions.map((question, i) => ({ question, expected: EVAL_QUESTIONS[i]!.expected }));
export const EVAL_SETS = { en: EVAL_QUESTIONS, ms: sameAnswers(MALAY), zh: sameAnswers(CHINESE) };

/** Ingests the synthetic corpus and reports hit@k: the share of questions whose expected source is in the top k. */
export async function evaluate(db: Db, embedder: Embedder, reranker?: Reranker, k = 5, questions = EVAL_QUESTIONS) {
  for (const { doc, text } of SYNTHETIC_CORPUS) await ingest(db, doc, text, embedder);
  const misses: { question: string; expected: string; got: string[] }[] = [];
  for (const { question, expected } of questions) {
    const got = (await search(db, { query: question, hospitalId: "eval", k }, embedder, reranker)).map(h => h.sourceId);
    if (!got.includes(expected)) misses.push({ question, expected, got });
  }
  return { hitAtK: 1 - misses.length / questions.length, misses };
}
