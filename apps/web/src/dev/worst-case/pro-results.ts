import { fixture, rows } from "./fixture";

// /pro/results and /pro/results/$resultId. test, value and unit are unbounded text (lab_results); flag is high, low,
// normal, critical high or critical low (day.ts LAB_FLAGS, critical.ts). The first rows each carry a different break.
const NAMES = ["Christopher Alexander Montgomery III", "Jo", "Đặng Thị Ngọc Hân", "王秀英", "Siti Nur Aisyah binti Mohd Khairuddin", "Seán O'Brien-Ó Súilleabháin", "Rajeswari a/p Subramaniam Thevarajan"];
const DOCTOR = "Dr Aleksandra Wiśniewska-Kowalczyk";
const at = (i: number) => new Date(Date.UTC(2026, 9, 7, 1, 0) - i * 37 * 60_000);
const day = (d: number) => new Date(Date.UTC(2026, 9, 7, 1, 0) - d * 86_400_000);

type Lab = { test: string; value: string; unit: string | null; flag: string | null; why?: string };
const LABS: Lab[] = [
  { test: "Glomerular filtration rate (estimated, CKD-EPI 2021)", value: "8", unit: "mL/min/1.73 m²", flag: "critical low",
    why: "Glomerular filtration rate (estimated, CKD-EPI 2021) 8 mL/min/1.73 m² is below the call-now limit of 15 mL/min/1.73 m²" },
  { test: "Troponin I (high-sensitivity)", value: "<0.01", unit: "µg/L", flag: "normal" },
  { test: "Creatine kinase", value: ">2000", unit: "U/L", flag: "high" },
  { test: "Serum potassium", value: "Haemolysed — repeat", unit: null, flag: null },
  { test: "White cell count", value: "23.4", unit: "x10^9/L", flag: "high", why: "White cell count 23.4 x10^9/L is above the usual adult range of 4 to 11 x10^9/L" },
  { test: "Na", value: "118", unit: "mmol/L", flag: "critical low", why: "Na 118 mmol/L is below the call-now limit of 120 mmol/L" },
  { test: "Blood culture (aerobic and anaerobic bottles, 2 sets)", value: "Gram-positive cocci in clusters, identification and sensitivities to follow", unit: null, flag: "high" },
  { test: "Haemoglobin A1c (IFCC)", value: "75", unit: "mmol/mol", flag: "low" },
];

const result = (i: number) => {
  const lab = LABS[i % LABS.length]!;
  const acknowledged = i % 5 === 4;
  return {
    id: `r-${i}`, patientId: `p-${i % NAMES.length}`, patientName: NAMES[i % NAMES.length]!, ...lab, why: lab.why,
    critical: Boolean(lab.flag?.startsWith("critical")), receivedAt: at(i),
    acknowledgedBy: acknowledged ? "u-aleksandra" : null, acknowledgedAt: acknowledged ? at(i - 1) : null, acknowledgedByName: acknowledged ? (i % 10 === 4 ? DOCTOR : null) : null,
  };
};
// Christopher's eGFR over the year, so the trend chart and the patient's other results have rows.
const trend = (i: number) => ({
  ...result(0), id: `r-egfr-${i}`, value: String(32 - i * 2), flag: "low", critical: false, why: undefined, receivedAt: day(330 - i * 30),
  acknowledgedBy: "u-aleksandra", acknowledgedAt: day(329 - i * 30), acknowledgedByName: DOCTOR,
});

export default [
  fixture("results.list", {
    worst: [...rows(37, result), ...rows(11, trend)],
    empty: [],
    one: rows(1, result),
    huge: [...rows(1000, result), ...rows(11, trend)],
  }),
];
