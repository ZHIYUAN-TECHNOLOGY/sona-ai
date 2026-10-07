import { fixture, rows } from "./fixture";

// Training data: management only; pro-session.ts signs the seeded doctor in as management on this page.
// The samples list is a function of its status filter, as the server's is; the server returns the newest 200.

const STATUSES = ["pending", "blocked", "approved", "excluded", "withdrawn"] as const;
const INPUTS = [
  "Pesakit [NAMA] berumur 67 tahun, dimasukkan ke Wad 4B dengan sesak nafas dan kaki bengkak selama tiga hari. Kalium 6.8 mmol/L, kreatinin 412 µmol/L. Apakah langkah seterusnya untuk hiperkalemia sebelum dialisis kecemasan?",
  "K 6.8?",
  "Discharge summary for [NAME], MRN [MRN], IC [IC]: community-acquired pneumonia treated with IV co-amoxiclav for 3 days then oral for 4; follow up at Klinik Kesihatan Bandar Baru Bangi in 7 days with a repeat chest X-ray and FBC.",
];
const OUTPUTS = [
  "Give 10 mL of 10% calcium gluconate IV over 10 minutes for membrane stabilisation, then 10 units of soluble insulin with 50 mL of 50% dextrose; recheck potassium in 1 hour and refer to nephrology for dialysis if it stays above 6.5 mmol/L or the ECG changes.",
  "Yes.",
  "Ringkasan discaj disediakan dalam Bahasa Melayu dan Bahasa Inggeris. 出院摘要已准备好。",
];
const DEID = ["openmed-pii-superclinical-large-v2 + rules", "rules", "openmed-pii-bioclinical-base"];
const sample = (i: number, status?: (typeof STATUSES)[number]) => ({
  id: `ts-${i}`, source: (["transcript", "note-edit", "check-in-reply", "handwritten-scan"] as const)[i % 4]!, input: INPUTS[i % INPUTS.length]!, output: OUTPUTS[i % OUTPUTS.length]!, replacements: [],
  status: status ?? STATUSES[i % STATUSES.length]!, leak: null, patientLabel: "Patient 9f8e", deidentifier: DEID[i % DEID.length]!,
});
const samples = (n: number) => (input?: { status?: (typeof STATUSES)[number] }) => rows(n, i => sample(i, input?.status));

export default [
  fixture("training.status", {
    worst: { contributes: true, counts: { pending: 1_284, approved: 12_345, blocked: 1, excluded: 0, withdrawn: 37 }, ready: 1_284_560, lastDataset: { version: 128, rows: 1_000_000, exportedAt: new Date(Date.UTC(2026, 8, 30)) } },
    one: { contributes: true, counts: { pending: 1, approved: 1, blocked: 1, excluded: 1, withdrawn: 1 }, ready: 1, lastDataset: { version: 1, rows: 1, exportedAt: new Date(Date.UTC(2026, 8, 30)) } },
    empty: { contributes: false, counts: { pending: 0, approved: 0, blocked: 0, excluded: 0, withdrawn: 0 }, ready: 0, lastDataset: null },
  }),
  fixture("training.samples", { worst: samples(9), empty: [], one: samples(1), huge: samples(1000) }),
];
