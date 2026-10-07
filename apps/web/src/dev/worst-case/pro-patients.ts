import type { client } from "@/lib/orpc";

import { fixture, rows } from "./fixture";

// patients.list: every column is `text` with no length limit (packages/db/src/schema/clinical.ts `patients`), age and sex
// are NOT NULL, so a record with neither known arrives as age 0 and sex "". The overview (pro-patient.ts) and the
// visit page (pro-visit.ts) read this same list; their fixture patient is SYN-1001 / encounter visit-1001.
type Patient = Awaited<ReturnType<typeof client.patients.list>>[number];

const base = (i: number): Patient => ({
  id: `SYN-${1001 + i}`, encounterId: `visit-${1001 + i}`, name: NAMES[i % NAMES.length]!, initials: "", age: 30 + (i * 7) % 60, sex: i % 2 ? "Female" : "Male",
  subtitle: "Bed 4B-12 · Ward 4B Medical (Respiratory and Infectious Diseases)", complaint: "Breathless on exertion for three days; worse lying flat.",
  history: ["Type 2 diabetes", "Hypertension"], family: "Father had a heart attack at 52.", social: "Ex-smoker, 20 pack-years. Lives with his daughter in a flat with no lift.",
  allergies: null, medicines: ["Metformin 500 mg twice daily", "Amlodipine 10 mg once daily"], vitals: [], sources: [], incomplete: false,
});

const NAMES = [
  "Tengku Puteri Nur Aisyah Zahratul 'Ain binti Tengku Muhammad Faris Iskandar Shah Al-Hajjah", // 90 characters
  "Jo", "Đặng Thị Ngọc Hân", "王秀英", "Christopher Alexander Montgomery III", "Seán O'Brien-Ó Súilleabháin",
  "Muthukumaran a/l Subramaniam Ramasamy Pillai", "Siti Nur Aisyah binti Mohd Khairuddin", "Lim Wei Jie", "Baby of Nurul Huda binti Abdullah",
];

// The longest realistic allergy entry: several allergens, each with the reaction and its source, separated by semicolons (300 characters).
const ALLERGIES = "Penicillin — anaphylaxis 2019, required adrenaline in ED (Hospital Kuala Lumpur); co-trimoxazole — Stevens-Johnson syndrome 2021; NSAIDs incl. ibuprofen and diclofenac — angioedema; latex — contact urticaria; shellfish — hives (patient-reported, not confirmed); iodinated contrast — mild rash in 2023.";

const MEDS = [
  "Metformin XR 1000 mg once daily with the evening meal", "Amlodipine 10 mg once daily", "Atorvastatin 40 mg at night", "Aspirin 75 mg once daily",
  "Bisoprolol 2.5 mg once daily", "Furosemide 40 mg in the morning", "Spironolactone 25 mg once daily", "Empagliflozin 10 mg once daily",
  "Insulin glargine (Lantus SoloStar) 22 units at bedtime", "Insulin aspart 6 units with meals", "Salbutamol 100 mcg inhaler 2 puffs as needed",
  "Budesonide/formoterol 160/4.5 mcg 2 puffs twice daily", "Tiotropium 18 mcg once daily", "Omeprazole 20 mg before breakfast",
  "Paracetamol 1 g four times daily as needed", "Gabapentin 300 mg three times daily", "Allopurinol 100 mg once daily", "Colchicine 0.5 mg twice daily during flares",
  "Levothyroxine 75 mcg before breakfast", "Calcium carbonate 1.25 g with vitamin D3 400 IU twice daily", "Ferrous fumarate 200 mg once daily",
  "Folic acid 5 mg once daily", "Vitamin B complex 1 tablet once daily", "Tamsulosin 400 mcg at night", "Finasteride 5 mg once daily",
  "Sertraline 50 mg once daily", "Zolpidem 5 mg at night as needed", "Lactulose 15 mL twice daily", "Senna 7.5 mg two tablets at night",
  "Chlorhexidine 0.2% mouthwash 10 mL twice daily", "Enoxaparin 40 mg subcutaneous once daily", "Clopidogrel 75 mg once daily",
  "Isosorbide mononitrate 30 mg once daily", "Glyceryl trinitrate 400 mcg spray as needed", "Perindopril 4 mg once daily", "Hydrochlorothiazide 12.5 mg once daily",
  "Prednisolone 30 mg once daily for 5 days, then stop", "Doxycycline 100 mg twice daily for 7 days", "Nicotine patch 21 mg/24 h daily", "Ondansetron 4 mg as needed",
];

const worst: Patient[] = [
  {
    ...base(0), age: 67, sex: "Female", allergies: ALLERGIES, medicines: MEDS,
    subtitle: "Bed 4B-12 · Ward 4B Medical (Respiratory and Infectious Diseases), Hospital Canselor Tuanku Muhriz UKM",
    complaint: "Increasing breathlessness for three days with a productive cough of green sputum, fever to 38.9 °C at home, and swelling of both ankles; she now sleeps upright on three pillows and could not finish a sentence on arrival.",
    history: ["Type 2 diabetes (HbA1c 9.8% in July)", "Heart failure with reduced ejection fraction (EF 30%)", "Chronic kidney disease stage 3b", "COPD, GOLD 3", "Atrial fibrillation on no anticoagulant after a GI bleed", "Gout", "Hypothyroidism", "Depression"],
    family: "Mother and two brothers with type 2 diabetes; father died of a stroke at 61; a sister had breast cancer at 48.",
    social: "Retired school teacher. Lives alone in a fourth-floor flat with no lift in Cheras; her son visits on Sundays. Ex-smoker, 40 pack-years, stopped 2015. No alcohol.",
    vitals: [{ label: "Blood pressure", value: "182/104 mmHg" }, { label: "SpO₂", value: "88% on 2 L" }, { label: "Heart rate", value: "128 bpm, irregular" }],
    ward: {
      status: "watch", waitingHours: 0,
      sbar: {
        s: "Day 2 of IV co-amoxiclav for a left lower lobe pneumonia with fluid overload; oxygen up from 2 L to 4 L overnight.",
        b: "HFrEF with EF 30%, CKD 3b, COPD GOLD 3; penicillin anaphylaxis on record although co-amoxiclav was charted.",
        a: "Worse since midnight: respiratory rate 28, SpO₂ 88% on 4 L, new crackles to the mid zones, urine output 15 mL/h for four hours.",
        r: "Senior review before 10:00; stop co-amoxiclav and switch the antibiotic given the allergy; chest X-ray and a furosemide infusion.",
      },
    },
    takeHome: [
      { name: "Insulin glargine (Lantus SoloStar) 100 units/mL pre-filled pen", change: "changed", detail: "22 units at bedtime, up from 16 units; check fingerstick glucose before breakfast and dinner and bring the log to clinic." },
      { name: "Spironolactone", change: "stopped", detail: "Stopped: potassium 6.8 mmol/L on 5 Oct." },
      { name: "Paracetamol", change: "unchanged", detail: "1 g four times daily as needed" },
    ],
  },
  { ...base(1), age: 0, sex: "", subtitle: "", complaint: "", history: [], family: "", social: "", medicines: [], incomplete: true, encounterId: "" },
  { ...base(2), ward: { status: "fit", waitingHours: 1, sbar: { s: "Post-op day 1.", b: "Nil.", a: "Eating and walking.", r: "Discharge today." } } },
  { ...base(3), ward: { status: "stable" }, allergies: "Penicillin", medicines: ["Paracetamol 1 g", "Paracetamol 1 g"] },
  { ...base(4), encounterId: "", subtitle: "", allergies: "Sulfonamides (patient-reported)" },
  { ...base(5), ward: { status: "fit", waitingHours: 52 }, complaint: "Cellulitis, left leg." },
  { ...base(6), ward: { status: "watch", sbar: { s: "Day 1.", b: "Nil.", a: "", r: "" } } },
  { ...base(7), incomplete: true },
  { ...base(8), ward: { status: "stable" } },
  { ...base(9), age: 0, sex: "Female", subtitle: "NICU cot 3", complaint: "Neonatal jaundice, day 4 of life." },
  ...rows(27, (i) => base(10 + i)),
];

export default [
  fixture("patients.list", {
    worst,
    empty: [],
    one: [{ ...base(0), name: "Jo", age: 1, sex: "Male", ward: { status: "fit", waitingHours: 1 } }],
    huge: rows(1000, (i) => ({ ...base(i), ward: i % 3 ? { status: "stable" as const } : { status: "watch" as const }, incomplete: i % 7 === 0 })),
  }),
];
