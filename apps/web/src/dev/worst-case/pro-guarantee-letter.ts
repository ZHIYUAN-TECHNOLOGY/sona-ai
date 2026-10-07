import { DEMO_PATIENTS } from "@sona-ai/domain/demo-patients";

import { fixture, rows } from "./fixture";

// Guarantee letter: the patient picker (patients.list, ward.beds) and an opened letter (claim.*), one status per visit:
// e-0 denied with the insurer's longest reason, e-1 a draft with every check open, e-2 queried, e-3 appealed, e-4 approved.
// patients.list is the same list the audit page's picker and names read.
const NAMES = ["Siti Nur Aisyah binti Mohd Khairuddin", "Christopher Alexander Montgomery III", "Jo", "Đặng Thị Ngọc Hân", "王秀英", "Seán O'Brien-Ó Súilleabháin", "Muthukumar a/l Subramaniam Pillai", "Aleksandra Wiśniewska-Kowalczyk"];
const WARDS = ["Wad Perubatan Lelaki 4B (Kardiologi), Hospital Canselor Tuanku Muhriz UKM", "Respiratory review", "ICU", "Wad Pediatrik 7A, Hospital Pakar Kanak-Kanak UKM · bed 12"];
const base = DEMO_PATIENTS[0]!;
const patient = (i: number) => ({ ...base, id: `p-${i}`, encounterId: `e-${i}`, name: NAMES[i % NAMES.length]!, initials: "", subtitle: WARDS[i % WARDS.length]! });
const bed = (i: number) => ({
  bed: `4B-${i + 1}`, patientId: `p-${i}`, name: NAMES[i % NAMES.length], status: "watch" as const, predicted: "Today 4 pm", blockers: i % 2 ? [] : [{
    id: `gl-${i}`, kind: "gl" as const, label: "Guarantee letter pending",
    detail: i ? "AIA Health Insurance (Malaysia) Bhd asked for the itemised bill and the admitting consultant's justification for the 4-day stay" : "Allianz",
  }],
});

const LONG = "Penderita mengalami demam dan batuk berkahak selama lima hari; X-ray dada pada 14 Sep 2026 menunjukkan konsolidasi lobus kanan bawah, dan CRP 184 mg/L disahkan oleh makmal pusat sebelum antibiotik IV dimulakan pada 16:40.";
const DENIAL = "The admission is not covered under the policy's pre-existing condition exclusion (Clause 4.2(b)), because the insured's records from Klinik Kesihatan Bandar Baru Bangi show treatment for bronchial asthma and recurrent lower respiratory tract infection within the 12 months before the policy's effective date of 1 March 2026. The insurer also notes that the discharge summary does not state why intravenous co-amoxiclav was started before an oral course was tried, nor does it name the organism, and that the chest X-ray report attached to the claim is unsigned. Under Clause 9.1 the insured may appeal within 30 days of this notice with a signed consultant's letter addressing each point, a copy of the culture and sensitivity report, and the signed radiology report. Until then, the hospital should collect the full deposit from the patient before discharge.";
const sentences = rows(30, i => ({ id: `s-${i}`, text: i % 3 ? `${LONG.slice(0, 120 + (i % 4) * 25)}.` : LONG }));
const CODE_LABELS = ["Pneumonia due to Streptococcus pneumoniae with associated pleural effusion and sepsis, not elsewhere classified", "Asthma, unspecified", "Allergy status to penicillin", "Routine chest X-ray"];
const code = (i: number) => ({
  code: i === 0 ? "J13" : i % 5 === 4 ? `87.44.${i}` : `J${18 + (i % 9)}.${i % 10}`, label: CODE_LABELS[i % CODE_LABELS.length]!,
  kind: (["Principal", "Secondary", "Procedure"] as const)[Math.min(i, 2) % 3]!, evidence: `s-${i}`, inTable: i % 7 !== 3,
});
const codes = (n: number) => ({ codes: rows(n, code), sentences: sentences.slice(0, Math.max(n, 1)), source: "model" as const, model: "medgemma-27b" });

const at = "2026-09-18T03:12:00.000Z";
const checks = [
  { id: "organism", label: "The organism is named or said to be unknown", status: "blocked" as const, detail: "The note names no organism and does not say it was not identified, so the insurer's reviewer cannot match the antibiotic to it." },
  { id: "iv", label: "Why IV antibiotics came before an oral course", status: "blocked" as const, detail: "No reason is given for starting IV co-amoxiclav first." },
  { id: "xray", label: "Imaging supports the diagnosis", status: "passed" as const, detail: `“${LONG}”` },
];
type Status = "draft" | "sent" | "approved" | "queried" | "denied" | "appealed";
const statusOf = (encounterId: string) => {
  const n = Number(encounterId.split("-")[1]) % 5;
  const s: Status = (["denied", "draft", "queried", "appealed", "approved"] as const)[n]!;
  const model = { source: "model" as const, model: "medgemma-27b" };
  if (s === "draft") return { status: s, checks };
  return {
    status: s, checks, codedBy: model, appealDraftedBy: s === "appealed" ? model : undefined, approvedAt: s === "approved" ? at : undefined, appealedAt: s === "appealed" ? at : undefined,
    query: s === "queried" ? "Please send the itemised bill, the culture and sensitivity report, and the admitting consultant's letter explaining the 4-day stay and why a general ward bed was not enough." : undefined,
    reviewUrl: s === "queried" || s === "appealed" ? "https://insurer.example.com/review/9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f?claim=GL-2026-0001284&tab=documents" : undefined,
    denial: s === "denied" || s === "appealed" ? { code: "PEC" as const, reason: DENIAL, note: s === "denied" ? "Reviewed by Dr Konstantin Oberhauser-Wettstein, Medical Underwriting." : undefined, at } : undefined,
  };
};

const appeal = (n: number) => ({
  letter: {
    opening: "Dear Medical Underwriting, Allianz General Insurance Company (Malaysia) Berhad, we appeal the denial of the guarantee letter for this admission on the following grounds, each taken from the signed clinical note.",
    points: rows(n, i => ({ claim: `${LONG} The pre-existing asthma did not cause this admission; community-acquired pneumonia did (point ${i + 1}).`, evidenceSentenceId: `s-${i}` })),
    closing: "We ask that the denial be reversed and the guarantee letter issued. The signed consultant's letter, the culture report and the radiology report are attached.",
  },
  sentences: sentences.slice(0, Math.max(n, 1)), source: "model" as const, model: "medgemma-27b", codedBy: { source: "model" as const, model: "medgemma-27b" },
});

export default [
  fixture("patients.list", { worst: rows(8, patient), empty: [], one: [patient(2)], huge: rows(1000, patient) }),
  fixture("ward.beds", { worst: rows(8, bed), empty: [], one: [bed(0)], huge: rows(1000, bed) }),
  fixture("claim.status", { worst: ({ encounterId }) => statusOf(encounterId), one: { status: "draft", checks: [checks[2]!] }, empty: { status: "draft", checks: [] } }),
  fixture("claim.suggestCodes", { worst: codes(30), empty: { codes: [], sentences: [], source: "fixture" }, one: codes(1), huge: codes(80) }),
  fixture("claim.appealDraft", { worst: appeal(12), one: appeal(1), empty: { ...appeal(0), sentences: [] } }),
];
