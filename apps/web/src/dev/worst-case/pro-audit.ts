import { fixture, rows } from "./fixture";

// Audit: the coding findings (audit.list) and one patient's access trail (accessLog.list). The patients behind the names
// and the access tab's picker come from patients.list in pro-guarantee-letter.ts.
const DOCTORS = ["Dr Aleksandra Wiśniewska-Kowalczyk", "Dr Jo", "Dato' Dr Muthukumar a/l Subramaniam Pillai, Consultant Nephrologist", "Dr 王秀英"];
const GAPS = [
  "The note says “AKI” but the creatinine rose from 88 to 412 µmol/L in 48 hours with oliguria, which meets KDIGO stage 3; stage 3 AKI is not coded, so the case-mix group drops a severity level and the insurer pays the lower DRG.",
  "Sepsis not documented",
  "Hyponatraemia (Na 118 mmol/L) treated with hypertonic saline is in the results but not in the note.",
];
const FROM = ["N17.9", null, "E87.1"];
const TO = ["N17.0", "A41.9", "E87.1"];
const RISK = [128_456_050, 100, 421_275, 0];
const item = (i: number) => ({
  id: `au-${i}`, hospitalId: "h-ukm", encounterId: `e-${i}`, patientId: `p-${i % 9}`, doctor: DOCTORS[i % DOCTORS.length]!,
  gap: GAPS[i % GAPS.length]!, fromCode: FROM[i % FROM.length] ?? null, toCode: TO[i % TO.length]!, riskCents: RISK[i % RISK.length]!,
  query: "Dr Wiśniewska-Kowalczyk, the creatinine trend (88 → 412 µmol/L over 48 h) and the urine output of 0.3 mL/kg/h for 14 hours meet KDIGO stage 3. Could you confirm the stage in the note, or say why it does not apply? Sona will not change the code until you answer.",
  status: "open" as const, createdAt: new Date(Date.UTC(2026, 9, 7, 2, 0)),
});

const WHO = ["Dr Aleksandra Wiśniewska-Kowalczyk", "Jo", "Siti Nur Aisyah binti Mohd Khairuddin (Jururawat Terlatih U29)", "A clinician"];
const DID = ["drafted an appeal against the denied claim", "opened the visit", "changed the discharge plan", "opened the record"];
const line = (i: number) => ({
  userId: `u-${i % 4}`, who: WHO[i % WHO.length]!, did: DID[i % DID.length]!, route: "encounter.get",
  at: new Date(Date.UTC(2026, 9, 7, 1, 0) - i * 41 * 60_000), times: [1, 1_284, 2, 1][i % 4]!,
});
const trail = (n: number) => ({ now: new Date(Date.UTC(2026, 9, 7, 2, 0)), lines: rows(n, line) });

export default [
  fixture("audit.list", { worst: rows(9, item), empty: [], one: [{ ...item(0), riskCents: 100 }], huge: rows(1000, item) }),
  // The server stops at 50 lines (the page asks for 50).
  fixture("accessLog.list", { worst: trail(50), empty: trail(0), one: trail(1), huge: trail(50) }),
];
