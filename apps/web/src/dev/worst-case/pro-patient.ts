import { fixture, rows } from "./fixture";

// The patient overview, /pro/patients/SYN-1001 (patients.list is in pro-patients.ts; results.list is in pro-results.ts).
// Every value here is unbounded text or an unbounded list on the server (timelineOf, adherenceOf, patients.trends).
const NOW = Date.UTC(2026, 9, 7, 1, 0);
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000);

// A lab drawn every day for a long stay plus home monitoring: 500 points inside the 12-month window.
const series500 = rows(500, (i) => ({ at: new Date(NOW - (499 - i) * 15 * 3_600_000), value: Math.round((5.2 + Math.sin(i / 9) * 1.8 + (i % 7) / 10) * 10) / 10, flag: i === 499 ? "critical-high" : null }));

const trendsWorst = {
  labs: [
    { test: "Estimated glomerular filtration rate (CKD-EPI 2021, creatinine-based)", unit: "mL/min/1.73 m²", points: [{ at: daysAgo(90), value: 41, flag: null }, { at: daysAgo(2), value: 24, flag: "low" }] },
    { test: "Fingerstick glucose", unit: "mmol/L", points: series500 },
    { test: "NT-proBNP", unit: "pg/mL", points: [{ at: daysAgo(1), value: 12840, flag: "critical-high" }] },
    { test: "Potassium", unit: "mmol/L", points: [{ at: daysAgo(30), value: 4.1, flag: null }, { at: daysAgo(2), value: 6.8, flag: "critical-high" }] },
    { test: "HbA1c", unit: "%", points: [{ at: daysAgo(80), value: 9.8, flag: "high" }] },
    { test: "C-reactive protein", unit: null, points: [{ at: daysAgo(3), value: 0.1 + 0.2, flag: null }, { at: daysAgo(1), value: 184, flag: "high" }] },
  ],
  observations: [
    { kind: "blood_pressure_systolic", source: "clinical" as const, unit: "mmHg", points: [{ at: daysAgo(5), value: 150 }, { at: daysAgo(1), value: 182 }] },
    { kind: "blood_pressure_systolic", source: "patient" as const, unit: "mmHg", points: rows(60, (i) => ({ at: daysAgo(60 - i), value: 138 + (i % 11) })) },
    { kind: "weight", source: "clinical" as const, unit: "kg", points: [{ at: daysAgo(1), value: 112.4 }] },
  ],
};

const EVENTS = [
  "Admitted to Ward 4B Medical (Respiratory and Infectious Diseases) from the Emergency Department",
  "Potassium 6.8 mmol/L, critical; spironolactone stopped", "Echo", "Seen in the heart failure clinic by Dr Aleksandra Wiśniewska-Kowalczyk",
];
const NEXT_VISIT = { id: "appt-9", at: new Date(Date.now() + 9 * 86_400_000), title: "Follow-up at the Klinik Pakar Perubatan Dalaman dan Kardiologi, Aras 4, Bangunan Klinik Pakar" };
const timeline = (n: number) => rows(n, (i) => ({
  id: `ev-${i}`, at: daysAgo(i * 3), title: EVENTS[i % EVENTS.length]!,
  detail: i % 4 === 0 ? "Brought in by her son after two nights sleeping upright; given IV furosemide 80 mg and oxygen 2 L in ED; bed requested at 02:14 and allocated at 09:40." : i % 4 === 2 ? undefined : "Ordered by Dr Jo",
}));

const DOSE_NAMES = ["Insulin glargine (Lantus SoloStar) 22 units", "Empagliflozin 10 mg", "Furosemide 40 mg", "Budesonide/formoterol 160/4.5 mcg"];
const doses = (n: number) => rows(n, (i) => ({ name: DOSE_NAMES[i % DOSE_NAMES.length]!, dueAt: new Date(NOW - i * 8 * 3_600_000) }));

export default [
  fixture("patients.trends", {
    worst: trendsWorst,
    empty: { labs: [], observations: [] },
    one: { labs: [{ test: "Potassium", unit: "mmol/L", points: [{ at: daysAgo(2), value: 4.1, flag: null }] }], observations: [] },
    huge: { labs: rows(40, (i) => ({ test: `${["Sodium", "Potassium", "Urea", "Creatinine", "Haemoglobin", "Platelets", "White cell count", "ALT"][i % 8]} (${i})`, unit: "mmol/L", points: series500 })), observations: [] },
  }),
  fixture("encounter.briefing", {
    worst: {
      source: "fixture",
      lines: [
        "Tengku Puteri Nur Aisyah, 67, is on day 2 of IV co-amoxiclav for a left lower lobe pneumonia with fluid overload, and her record lists penicillin anaphylaxis in 2019 that needed adrenaline; she has HFrEF with an ejection fraction of 30%, CKD 3b and COPD, her potassium was 6.8 mmol/L two days ago, and she has missed 12 doses since her last discharge, mostly the evening insulin.",
        "Potassium 6.8 mmol/L on 5 Oct (critical); spironolactone stopped the same day.",
        "eGFR fell from 41 to 24 mL/min/1.73 m² in three months.",
        "Weight 112.4 kg, up 4 kg in a week.",
      ],
    },
    empty: { source: "fixture", lines: [] },
    one: { source: "fixture", lines: ["Nothing new since the last visit."] },
  }),
  // The next booked visit leads, as X-ray's recall reads it.
  fixture("encounter.timeline", { worst: [NEXT_VISIT, ...timeline(60)], empty: [], one: timeline(1), huge: timeline(1000) }),
  fixture("adherence.get", {
    worst: { due: 1284, taken: 1259, missed: doses(12), late: doses(13).slice(12), line: "Missed 12 doses since discharge, mostly the bedtime insulin glargine on weekends." },
    empty: { due: 0, taken: 0, missed: [], late: [], line: "" },
    one: { due: 1, taken: 0, missed: [], late: doses(1), line: "" },
    huge: { due: 1284, taken: 284, missed: doses(1000), late: [], line: "Missed 1,000 doses." },
  }),
  fixture("care.code", { worst: { code: "K7QM-4ZXP", link: "sona-care://join?code=K7QM-4ZXP", expiresAt: new Date(NOW + 7 * 86_400_000), joined: false } }),
];
