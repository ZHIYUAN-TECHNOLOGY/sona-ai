import type { MedChange } from "@sona-ai/domain/discharge";

import { fixture, rows } from "./fixture";
import { nameOf, WORST_BEDS } from "./pro-ward";

// /pro/discharge: the picker ranks patients.list by the ward's beds (pro-ward.ts registers ward.beds); a plan opens
// with ?encounterId=e-<i>. Patient ids p-<i> match the beds' patientIds.
const SUBTITLE = ["Community-acquired pneumonia with type 2 respiratory failure, step-down from HDU", "Asthma", "Fall at home, fractured neck of femur, day 9 after hemiarthroplasty", "", "Cellulitis"];
const patient = (i: number) => ({
  id: `p-${i}`, encounterId: `e-${i}`, name: nameOf(i), initials: "", age: 18 + (i * 7) % 83, sex: i % 2 ? "Male" : "Female", subtitle: SUBTITLE[i % SUBTITLE.length]!,
  complaint: "Cough and fever", history: [], family: "", social: "", allergies: null, medicines: [], vitals: [], sources: [], incomplete: i % 5 === 3,
});
const patients = (n: number) => rows(n, patient);

const MEDS: MedChange[] = [
  { name: "Insulin glargine (Lantus SoloStar) 100 units/mL prefilled pen", change: "changed", detail: "24 units subcutaneously at 22:00 nightly, was 18 units; check fingerprick glucose before breakfast and dinner" },
  { name: "Amoxicillin-clavulanate", change: "new", detail: "625 mg three times a day for 5 more days" },
  { name: "Spironolactone", change: "stopped", detail: "Stopped: potassium 6.8 mmol/L" },
  { name: "Paracetamol", change: "unchanged", detail: "" },
  { name: "Ipratropium bromide/salbutamol (Combivent UDV) nebuliser solution", change: "new", detail: "2.5 mL four times a day as needed" },
];
const med = (i: number): MedChange => i < MEDS.length ? MEDS[i]! : { name: ["Atorvastatin", "Metformin", "Bisoprolol", "Omeprazole", "Furosemide"][i % 5]!, change: "unchanged", detail: `${10 * (i % 4 + 1)} mg once a day` };

const check = (i: number, blocked: boolean) => blocked
  ? { id: `c-${i}`, status: "blocked" as const, label: ["Final guarantee letter", "Urine culture and sensitivities, repeat sample after contamination", "Take-home medicines confirmed", "Follow-up booked", "Ride home", "Potassium below 5.5 mmol/L", "Benachrichtigungseinstellungen", "Echocardiogram reported"][i % 8]!,
    detail: i === 0 ? "Great Eastern Takaful Berhad (Corporate Panel, Petronas Dagangan) · requested 08:10, chased 11:40 and 14:05" : i === 6 ? "" : "Waiting since 08:10" }
  : { id: `ok-${i}`, status: "passed" as const, label: ["Medically fit, marked by the ward doctor", "Observations within range for 24 hours", "Leaflet language chosen"][i % 3]!, detail: "" };

const LONG = "Admitted with community-acquired pneumonia (CURB-65 score 3) complicated by type 2 respiratory failure needing non-invasive ventilation in the HDU for 48 hours. Treated with IV ceftriaxone and azithromycin, stepped down to oral amoxicillin-clavulanate on day 5. New atrial fibrillation on day 3, rate controlled with bisoprolol; CHA₂DS₂-VASc 4, anticoagulation discussed and deferred to clinic because of a previous upper GI bleed. Potassium rose to 6.8 mmol/L on spironolactone, which was stopped.";
const plan = (blocked: number, passed: number, meds: number, long: boolean) => ({
  plan: {
    bed: long ? "Bed 12A (Isolation, side room)" : "Bed 1",
    summary: long
      ? { diagnosis: "Community-acquired pneumonia with type 2 respiratory failure; new atrial fibrillation; hyperkalaemia (potassium 6.8 mmol/L) on spironolactone", course: LONG, plan: `${LONG} Clinic review in 2 weeks with a repeat chest X-ray at 6 weeks.` }
      : { diagnosis: "Pneumonia", course: "Improved on antibiotics.", plan: "Home." },
    full: long ? LONG : "Pneumonia.", meds: rows(meds, med), leaflet: { en: LONG, ms: LONG, zh: LONG }, visit: {},
  },
  waits: [],
  state: { glReceived: false, medsConfirmed: false, language: "en" as const, checkInDays: [1, 3, 7, 14, 21, 30] },
  checks: [...rows(blocked, i => check(i, true)), ...rows(passed, i => check(i, false))],
});

export default [
  fixture("patients.list", { worst: patients(WORST_BEDS.length), empty: [], one: patients(1), huge: patients(1000) }),
  fixture("discharge.plan", { worst: plan(8, 3, 25, true), empty: plan(0, 0, 0, false), one: plan(0, 1, 1, false) }),
  fixture("discharge.draft", {
    worst: input => ({ summary: `${LONG}\n\n${LONG}\n\n${LONG}`, leaflet: LONG, language: input.language, source: "model" as const, model: "medgemma-27b" }),
    one: input => ({ summary: "Pneumonia, treated.", leaflet: "Rest.", language: input.language, source: "fixture" as const }),
  }),
];
