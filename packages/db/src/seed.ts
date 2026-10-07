import { hashPassword } from "better-auth/crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core/async";
import { DEMO_PATIENTS } from "@sona-ai/domain/demo-patients";
import { LANGUAGES, PATIENT_LEAFLETS, type MedChange } from "@sona-ai/domain/discharge";
import { DOCTORS } from "@sona-ai/domain/doctors";
import { WARD_FIXTURE, type Bed, type BlockerKind } from "@sona-ai/domain/ward";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { account, admissions, appointments, careLinks, casemixWeights, doctors, drugs, encounters, followUpRules, guaranteeLetters, hospitalMembers, hospitals, icd10Codes, insurerCriteria, labResults, notes, observations, patients, user } from "./schema";

/**
 * The demo ward's starting state, matching the app's fixtures (synthetic people only). Idempotent,
 * so it can run on every boot of a test or staging database. Reference tables (ICD-10, drugs) load
 * from the repo's data/ folder and are upserted, so a corrected file reaches a seeded database.
 * Reads files from disk: run it from Bun/Node (tests, a seed script), not inside the Worker.
 */
import { DEMO_HOSPITAL, DEMO_PATIENT_PHONE } from "./demo";
export { DEMO_HOSPITAL };
/**
 * The beds the sample screens never drew, so the connected ward and patient list read as a working ward
 * (16 beds taken) rather than seven. Fictional people only, written like the fixture beds and seeded the
 * same way. Kept out of WARD_FIXTURE so sample mode's ward and its counts stay as they were. One is fit
 * and ready and none is blocked, so the ward's blocked count and bed-hours waiting stay the demo's.
 */
export const WARD_EXTRA: Bed[] = [
  { bed: "Bed 7", name: "Dayang Suhaila", initials: "DS", meta: "37 · Female", status: "fit", predicted: "15:30", waitingHours: 2,
    sbar: { s: "Day 3, asthma exacerbation.", b: "Asthma since childhood.", a: "Peak flow 85% of best, off nebulisers for 24 h.", r: "Discharge today with an inhaler plan; clinic in 2 weeks." }, blockers: [] },
  { bed: "Bed 1", name: "Hafizah Yusof", initials: "HY", meta: "54 · Female", status: "watch", predicted: "Tomorrow",
    sbar: { s: "Day 2, diabetic ketoacidosis, now on subcutaneous insulin.", b: "Type 1 diabetes.", a: "Ketones cleared, eating, glucose 8 to 11.", r: "Diabetes nurse review, then home tomorrow." }, blockers: [] },
  { bed: "Bed 5", name: "Suresh Pillai", initials: "SP", meta: "48 · Male", status: "watch", predicted: "Tomorrow",
    sbar: { s: "Day 2, gallstone pancreatitis.", b: "No significant history.", a: "Pain settling, tolerating fluids, lipase falling.", r: "Surgical review for a cholecystectomy date." }, blockers: [] },
  { bed: "Bed 13", name: "Wong Siew Ling", initials: "WS", meta: "72 · Female", status: "watch", predicted: "Tomorrow",
    sbar: { s: "Day 3 of IV antibiotics for urosepsis.", b: "Hypertension.", a: "Afebrile 24 h, CRP falling.", r: "Oral switch tomorrow if the cultures agree." }, blockers: [] },
  { bed: "Bed 17", name: "Harjit Singh", initials: "HS", meta: "63 · Male", status: "watch", predicted: "Tomorrow",
    sbar: { s: "Upper GI bleed, day 2 after endoscopy.", b: "On aspirin for ischaemic heart disease.", a: "Hb stable at 9.4, no further melaena.", r: "Repeat Hb in the morning; restart aspirin per cardiology." },
    blockers: [{ id: "b17-hb", kind: "result", label: "Repeat haemoglobin", detail: "Due 06:00" }] },
  { bed: "Bed 11", name: "Ganesan Muthu", initials: "GM", meta: "66 · Male", status: "watch", predicted: "In 2 days",
    sbar: { s: "COPD exacerbation, day 3.", b: "Ex-smoker, 40 pack-years.", a: "On 1 L oxygen, steroids day 3.", r: "Wean oxygen; home oxygen assessment." }, blockers: [] },
  { bed: "Bed 16", name: "Rosnah Ismail", initials: "RI", meta: "81 · Female", status: "watch", predicted: "In 2 days",
    sbar: { s: "Fall with a fractured wrist; delirium settling.", b: "Dementia, lives with her daughter.", a: "Eating, sleeping better, AMT 6/10.", r: "Physiotherapy and a family meeting before discharge." }, blockers: [] },
  { bed: "Bed 3", name: "Chong Mei Yee", initials: "CM", meta: "61 · Female", status: "stable", predicted: "In 2 days",
    sbar: { s: "Day 6 after a left hip hemiarthroplasty.", b: "Osteoporosis.", a: "Walking with a frame, pain controlled.", r: "Home once the stairs assessment is passed." }, blockers: [] },
  { bed: "Bed 15", name: "Jimmy Anak Sali", initials: "JS", meta: "59 · Male", status: "stable", predicted: "Awaiting angiogram",
    sbar: { s: "NSTEMI, day 2, pain-free on dual antiplatelets.", b: "Type 2 diabetes, smoker.", a: "Troponin peaked, ECG stable.", r: "Transfer for an angiogram when the cardiac centre has a slot." },
    blockers: [{ id: "b15-transfer", kind: "transport", label: "Transfer to cardiac centre", detail: "Waiting for a slot" }] },
];
/**
 * Each ward patient's chart, by bed: the rest of a believable record for the bed's SBAR. FICTIONAL, like the people:
 * written for a Malaysian medical ward and seeded into the real tables (the patient's record, the observations chart,
 * the visit's note), which is where the app, the rules and the models read it from. `medicines` are those taken before
 * admission. `obs`: temperature °C, pulse, respiratory rate, SpO₂ %, systolic and diastolic pressure. `note`: the visit's
 * saved note by section (subjective, objective, assessment, plan). `takeHome`: charted only once a bed is fit to go.
 * No `allergies` means none is on record (the app has no way to say "none known" yet), not that there is none.
 */
type Chart = {
  subtitle: string; allergies?: string; history: string[]; family: string; social: string; medicines: string[];
  obs: [temperature: number, pulse: number, respiratoryRate: number, spo2: number, systolic: number, diastolic: number];
  note: [subjective: string, objective: string, assessment: string, plan: string]; takeHome?: MedChange[];
};
const PARACETAMOL: MedChange = { name: "Paracetamol", change: "new", detail: "1 g every 6 h as needed, max 4 g a day" };
const CHARTS: Record<string, Chart> = {
  "Bed 2": { subtitle: "Pyelonephritis", history: ["Two days of right loin pain, fever and dysuria before admission", "No previous admission", "No regular medicines"],
    family: "No family history of kidney disease.", social: "Primary school teacher. Married, one child. Does not smoke.", medicines: [], obs: [36.9, 78, 16, 99, 112, 70],
    note: ["Two days of right loin pain, fever and dysuria before admission. Now pain-free, eating and walking.", "Afebrile for 36 hours. Renal ultrasound: no obstruction or abscess. Urine culture grew E. coli; sensitivities pending.",
      "Acute pyelonephritis, uncomplicated; qSOFA 0 on admission.", "IV cefuroxime, day 3; oral once the sensitivities are back. Home when the final guarantee letter arrives."],
    takeHome: [{ name: "Cefuroxime", change: "changed", detail: "IV to oral 500 mg twice daily, to finish 10 days (check against sensitivities)" }, PARACETAMOL] },
  "Bed 14": { subtitle: "Appendicectomy, day 1", history: ["One day of central abdominal pain moving to the right iliac fossa", "Laparoscopic appendicectomy yesterday, uncomplicated", "No regular medicines"],
    family: "Nil of note.", social: "Software engineer. Lives with his wife. Does not smoke; drinks socially.", medicines: [], obs: [37.1, 84, 16, 98, 124, 78],
    note: ["Pain controlled on oral analgesia, eating and mobilising. Passed flatus.", "Afebrile. Abdomen soft, port sites clean and dry.",
      "Day 1 after laparoscopic appendicectomy for acute appendicitis, uncomplicated.", "Home today on simple analgesia. Wound check at the surgical clinic in 1 to 2 weeks."],
    takeHome: [PARACETAMOL, { name: "Ibuprofen", change: "new", detail: "400 mg every 8 h with food, for 3 days" }, { name: "Morphine", change: "stopped", detail: "Ward-only pain relief, not needed at home" }] },
  "Bed 8": { subtitle: "Cellulitis, left leg", allergies: "Penicillin — rash as a child", history: ["Type 2 diabetes for eight years", "Three days of redness and swelling of the left lower leg before admission", "HbA1c 8.1% in June"],
    family: "Mother has type 2 diabetes.", social: "Runs a food stall. Lives with her husband and two teenagers. Does not smoke.", medicines: ["Metformin 1 g, twice daily"], obs: [36.8, 80, 16, 98, 128, 80],
    note: ["Left leg less painful; walking to the bathroom unaided.", "Afebrile for 48 hours. Redness receding inside the marked line. Capillary glucose 7 to 10.",
      "Cellulitis of the left lower leg, improving; type 2 diabetes.", "Oral clindamycin for 5 more days (penicillin allergy). Wound clinic in 1 week."],
    takeHome: [{ name: "Clindamycin", change: "changed", detail: "IV to oral 300 mg four times daily, 5 more days" }, PARACETAMOL, { name: "Metformin", change: "unchanged", detail: "Continue as before" }] },
  "Bed 12": { subtitle: "Pneumonia, day 2", history: ["Type 2 diabetes and hypertension", "Three days of productive cough and fever before admission"],
    family: "Sister has type 2 diabetes.", social: "Retired tailor. Lives with her son's family. Never smoked.", medicines: ["Metformin 500 mg, twice daily", "Amlodipine 5 mg, once daily"], obs: [37.2, 92, 20, 94, 134, 76],
    note: ["Cough easing, less breathless. Eating half portions.", "Afebrile since 06:00. SpO₂ 94% on 2 L oxygen. Chest X-ray: left lower zone consolidation.",
      "Community-acquired pneumonia, CURB-65 2 on admission.", "IV amoxicillin-clavulanate, day 2. Review the oral switch on the morning round; wean oxygen."] },
  "Bed 9": { subtitle: "Heart failure", allergies: "Perindopril — dry cough", history: ["Heart failure with a reduced ejection fraction (35% in 2025)", "Chronic kidney disease stage 3", "A week of worsening breathlessness and ankle swelling before admission"],
    family: "Father died of a heart attack at 62.", social: "Retired lorry driver. Lives with his wife. Stopped smoking ten years ago.",
    medicines: ["Furosemide 40 mg, each morning", "Bisoprolol 2.5 mg, once daily", "Losartan 50 mg, once daily"], obs: [36.6, 76, 18, 95, 118, 70],
    note: ["Breathing easier, sleeping on two pillows. Ankles less swollen.", "Weight down 1.2 kg since admission. Fine basal crackles. Creatinine 148 yesterday.",
      "Acute decompensated heart failure, responding to IV furosemide; chronic kidney disease stage 3.", "IV furosemide 40 mg twice daily. Repeat renal function at 06:00. Daily weights and a 1.5 L fluid limit."] },
  "Bed 4": { subtitle: "Stroke, day 9", history: ["Hypertension and atrial fibrillation", "Nine days ago: right arm weakness and slurred speech", "Swallow assessed as safe for a soft diet on day 3"],
    family: "Brother had a stroke at 70.", social: "Retired shopkeeper. Lives with his wife; a daughter lives nearby. Never smoked.", medicines: ["Amlodipine 10 mg, once daily"], obs: [36.7, 72, 16, 97, 138, 82],
    note: ["Comfortable. Speech clearer; right hand grip improving.", "CT brain on admission: left middle cerebral artery infarct, no bleed. Power 4/5 in the right arm. Atrial fibrillation, rate 72.",
      "Ischaemic stroke, day 9, medically stable; atrial fibrillation.", "Apixaban and atorvastatin started. Awaiting an inpatient rehabilitation bed; physiotherapy daily."] },
  "Bed 7": { subtitle: "Asthma exacerbation", allergies: "Aspirin — wheeze", history: ["Asthma since childhood, two admissions in the past five years", "Exacerbation after a week of a cold", "Uses her preventer inhaler irregularly"],
    family: "Mother and brother have asthma.", social: "Bank clerk. Lives with her husband and two children. Does not smoke; no pets.",
    medicines: ["Budesonide-formoterol inhaler, 2 puffs twice daily", "Salbutamol inhaler, as needed"], obs: [36.7, 82, 16, 98, 116, 74],
    note: ["No wheeze overnight; walking the ward without breathlessness.", "Peak flow 85% of her best. Chest clear. Off nebulisers for 24 hours.",
      "Acute asthma exacerbation, resolved.", "Prednisolone 40 mg daily for 2 more days. Inhaler technique checked and a written asthma plan given. Clinic in 2 weeks."],
    takeHome: [{ name: "Prednisolone", change: "new", detail: "40 mg each morning, 2 more days" }, { name: "Nebulised salbutamol", change: "stopped", detail: "Back to her own inhaler as needed" },
      { name: "Budesonide-formoterol inhaler", change: "unchanged", detail: "Continue as before" }, { name: "Salbutamol inhaler", change: "unchanged", detail: "Continue as before" }] },
  "Bed 1": { subtitle: "Diabetic ketoacidosis", history: ["Type 1 diabetes since the age of 19", "Missed insulin for two days during a stomach bug", "Last HbA1c 9.2%"],
    family: "No family history of diabetes.", social: "Clinic receptionist. Lives with her husband. Does not smoke.", medicines: ["Insulin glargine 22 units, at night", "Insulin aspart, with meals"], obs: [36.8, 88, 16, 98, 122, 76],
    note: ["Eating full meals, no nausea.", "Ketones 0.3, bicarbonate 22. Capillary glucose 8 to 11 on subcutaneous insulin.",
      "Diabetic ketoacidosis, resolved; brought on by missed insulin during gastroenteritis.", "Back on her usual basal-bolus insulin. Diabetes nurse to go through sick-day rules; home tomorrow."] },
  "Bed 5": { subtitle: "Gallstone pancreatitis", history: ["Two episodes of biliary colic earlier this year", "Admitted with severe epigastric pain and vomiting", "No regular medicines"],
    family: "Mother had gallstones.", social: "Accountant. Lives with his wife and three children. Rarely drinks alcohol; does not smoke.", medicines: [], obs: [37.0, 86, 18, 97, 126, 80],
    note: ["Pain 3 out of 10, tolerating clear fluids, no vomiting since yesterday.", "Ultrasound: gallstones, common bile duct not dilated. Lipase 420, down from 1,850.",
      "Acute gallstone pancreatitis, mild.", "IV fluids and analgesia; build up the diet. Surgical review for a cholecystectomy date."] },
  "Bed 13": { subtitle: "Urosepsis", allergies: "Co-trimoxazole — rash", history: ["Hypertension", "Two urinary infections in the past year", "Admitted confused, with fever and rigors"],
    family: "Nil of note.", social: "Retired teacher. Lives alone; her daughter visits daily. Never smoked.", medicines: ["Amlodipine 5 mg, once daily"], obs: [37.0, 84, 18, 96, 128, 72],
    note: ["Alert and orientated today, drinking well.", "Afebrile for 24 hours. CRP 64, down from 212. Blood and urine cultures grew E. coli.",
      "Urosepsis, improving on IV ceftriaxone.", "IV ceftriaxone, day 3; oral switch tomorrow if the sensitivities agree."] },
  "Bed 17": { subtitle: "Upper GI bleed", history: ["Ischaemic heart disease, one stent in 2021", "Admitted with black stools and dizziness", "Endoscopy yesterday: duodenal ulcer, clipped"],
    family: "Father had ischaemic heart disease.", social: "Taxi driver. Lives with his wife. Stopped smoking in 2021; no alcohol.",
    medicines: ["Aspirin 100 mg, once daily (on hold)", "Atorvastatin 40 mg, at night", "Bisoprolol 5 mg, once daily"], obs: [36.6, 78, 16, 98, 118, 72],
    note: ["No further black stools; no dizziness on standing.", "Haemoglobin 9.4, stable over 24 hours. Endoscopy: duodenal ulcer, clipped, no active bleeding.",
      "Upper gastrointestinal bleed from a duodenal ulcer, bleeding stopped; anaemia from blood loss.", "IV pantoprazole, then oral. Repeat haemoglobin in the morning; restart aspirin as cardiology advises."] },
  "Bed 11": { subtitle: "COPD exacerbation", history: ["COPD, two exacerbations this year", "Smoked for 40 pack-years, stopped in 2022", "Three days of worsening breathlessness and green sputum before admission"],
    family: "Nil of note.", social: "Retired rubber tapper. Lives with his wife. Walks about 100 m on the flat.", medicines: ["Tiotropium inhaler, once daily", "Salbutamol inhaler, as needed"], obs: [36.9, 90, 20, 92, 132, 78],
    note: ["Less breathless; sputum now white.", "SpO₂ 92% on 1 L oxygen. Chest X-ray: hyperinflated, no consolidation. Scattered wheeze.",
      "Acute exacerbation of COPD, improving.", "Prednisolone and doxycycline, day 3 of 5. Wean oxygen; home oxygen assessment before discharge."] },
  "Bed 16": { subtitle: "Fall, wrist fracture", history: ["Alzheimer's dementia, diagnosed in 2023", "Fell in the bathroom at home: left distal radius fracture, in a cast", "Osteoarthritis of both knees"],
    family: "Not known.", social: "Widow. Lives with her daughter, who is her main carer. Walks with a stick.", medicines: ["Donepezil 5 mg, at night", "Paracetamol 1 g, three times daily"], obs: [36.5, 74, 16, 97, 136, 70],
    note: ["Calmer; slept through the night. Eating with help.", "AMT 6/10, up from 4/10 on admission. Wrist X-ray: distal radius fracture in a good position in the cast.",
      "Fall with a left distal radius fracture; delirium on dementia, settling.", "Physiotherapy and a falls assessment. Family meeting before discharge; fracture clinic in 1 week."] },
  "Bed 3": { subtitle: "Hip hemiarthroplasty, day 6", allergies: "Codeine — nausea and vomiting", history: ["Osteoporosis", "Fell at the market: left neck of femur fracture", "Left hip hemiarthroplasty six days ago"],
    family: "Mother had a hip fracture.", social: "Runs a sundry shop with her husband. Lives above the shop; the bedroom is upstairs.", medicines: ["Calcium and vitamin D, once daily"], obs: [36.7, 76, 16, 98, 124, 76],
    note: ["Pain 2 out of 10 on paracetamol. Walking 20 m with a frame.", "Wound clean and dry. Haemoglobin 10.8.",
      "Day 6 after a left hip hemiarthroplasty for a neck of femur fracture; anaemia after surgery, not transfused.", "Enoxaparin until day 28. Stairs assessment with physiotherapy; alendronate to start at the clinic."] },
  "Bed 15": { subtitle: "NSTEMI, day 2", history: ["Type 2 diabetes for ten years", "Smokes 15 cigarettes a day", "Admitted with an hour of central chest pain at rest"],
    family: "Brother had a heart attack at 55.", social: "Lorry mechanic from Sibu, working in Klang. Lives with his wife.", medicines: ["Metformin 1 g, twice daily", "Gliclazide 80 mg, once daily"], obs: [36.6, 68, 16, 98, 122, 74],
    note: ["Pain-free since admission. No breathlessness.", "Troponin peaked at 1,240. ECG: T-wave inversion in V4 to V6, unchanged. Echocardiogram: ejection fraction 50%.",
      "Non-ST elevation myocardial infarction, day 2, stable.", "Aspirin, ticagrelor, fondaparinux, atorvastatin and bisoprolol. Transfer for an angiogram when the cardiac centre has a slot."] },
};
const OBS = [["temperature", "°C"], ["pulse", "bpm"], ["respiratory-rate", "/min"], ["oxygen-saturation", "%"], ["systolic", "mmHg"], ["diastolic", "mmHg"]] as const;
const NOTE_SECTIONS = ["subjective", "objective", "assessment", "plan"] as const;
// Amelia's (SYN-1042) saved note, a line per section, from her record: the intake, her ward record (DEMO_WARD) and her take-home list.
const AMELIA_NOTE = [
  "Five days of cough, with fever from the day before admission. Now eating and walking; the cough is easing.",
  "Afebrile for 18 hours. SpO₂ 97% on room air. Chest film: right lower zone consolidation.",
  "Community-acquired pneumonia, mild; CURB-65 0. Background asthma, on a salbutamol inhaler. Penicillin allergy reported.",
  "IV azithromycin given, day 2; oral azithromycin 500 mg daily for 2 more days. Fit for discharge today; home when the final guarantee letter arrives.",
];
/** "5 Oct 2026, 07:00" on the ward's clock (Malaysia), whichever zone the seed runs in. */
const wardTime = (at: Date) => at.toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * The rest of the ward, read off the fixture beds and WARD_EXTRA so live mode draws them: bed N holds SYN-20NN
 * with each blocker turned into the row it derives from (a requested GL, a pending result, discharge state).
 */
const WARD = [...WARD_FIXTURE, ...WARD_EXTRA].filter(b => b.name).map(b => {
  const n = b.bed.replace("Bed ", "").padStart(2, "0"), of = (kind: BlockerKind) => b.blockers.filter(x => x.kind === kind);
  const [age, sex] = b.meta!.split(" · "), [ride] = of("transport");
  const state = {
    ...(b.status === "fit" && { discharge: { medsConfirmed: !of("pharmacy").length, followUp: "2w" } }),
    // Transport has no table yet: a ride or transfer still to arrange lives in the visit state.
    ...(ride && { transport: { label: ride.label, detail: ride.detail } }),
  };
  return { n, id: `SYN-20${n}`, bed: b, chart: CHARTS[b.bed]!, age: Number(age), sex: sex!, state, gl: of("gl").length > 0, labs: of("result").map(r => ({ id: `lab-20${n}-${r.id}`, test: r.label })) };
});
/** The lab results the seed writes; any other result arrived during a demo run. */
export const SEED_LAB_IDS = ["lab-1086-potassium", "lab-hb-1086", ...WARD.flatMap(w => w.labs.map(l => l.id))];
/**
 * The synthetic demo logins (fictional people at the demo hospital, never real accounts), shown to audiences as
 * `<username> / 123`: the sign-in forms turn a bare username into `<username>@sona.test`. Seeding resets every
 * password to this list on each run, so a login is always what the slide says.
 */
export const DEMO_ACCOUNTS = [
  { username: "doctor", email: "doctor@sona.test", password: "123", name: "Dr Test Aisyah", role: "doctor" },
  { username: "nurse", email: "nurse@sona.test", password: "123", name: "Nurse Test Mei Ling", role: "nurse" },
  { username: "beds", email: "beds@sona.test", password: "123", name: "Test Bed Manager Hafiz", role: "bed-manager" },
  { username: "manager", email: "manager@sona.test", password: "123", name: "Test Manager Farah", role: "management" },
  { username: "doctor2", email: "doctor2@sona.test", password: "123", name: "Dr Test Rajesh Kumar", role: "doctor" },
  { username: "nurse2", email: "nurse2@sona.test", password: "123", name: "Nurse Test Siti Aminah", role: "nurse" },
  { username: "patient", email: "patient@sona.test", password: "123", name: "Amelia Tan", role: "patient" },
] as const;
/** The addresses these accounts had before the memorable usernames, so a staging account signed up under one keeps its data. */
export const LEGACY_EMAILS: Record<string, string> = {
  "doctor@sona.test": "dr.test@sona.test", "nurse@sona.test": "nurse.test@sona.test", "beds@sona.test": "beds.test@sona.test",
  "manager@sona.test": "manager.test@sona.test", "doctor2@sona.test": "dr2.test@sona.test", "nurse2@sona.test": "nurse2.test@sona.test",
  "patient@sona.test": "amelia.test@sona.test",
};
type DemoAccount = (typeof DEMO_ACCOUNTS)[number];
const demoAccount = <U extends DemoAccount["username"]>(username: U) => DEMO_ACCOUNTS.find(a => a.username === username) as Extract<DemoAccount, { username: U }>;
/** The synthetic test doctor for local and staging end-to-end runs. */
export const TEST_DOCTOR = { id: "test-doctor", ...demoAccount("doctor") };
/** Synthetic test accounts for the other clinician roles; all are seeded by seedTestStaff as members of the demo hospital. */
export const TEST_NURSE = { id: "test-nurse", ...demoAccount("nurse") };
export const TEST_BED_MANAGER = { id: "test-bed-manager", ...demoAccount("beds") };
export const TEST_MANAGER = { id: "test-manager", ...demoAccount("manager") };
/** Two more synthetic clinicians, so the demo doctor's handover always has a colleague to receive it. */
export const TEST_DOCTOR_2 = { id: "test-doctor-2", ...demoAccount("doctor2") };
export const TEST_NURSE_2 = { id: "test-nurse-2", ...demoAccount("nurse2") };
/**
 * The synthetic test patient for Sona Care runs: seeded as a signed-up account already linked to Amelia (SYN-1042)
 * by seedTestPatient, so it signs in with this email and password, or with the demo phone (DEMO_PATIENT_PHONE),
 * without a doctor issuing a code.
 */
export const TEST_PATIENT = { ...demoAccount("patient"), phone: DEMO_PATIENT_PHONE, patientId: "SYN-1042" };
// Any drizzle Postgres database: Neon in staging, PGlite in tests.
type AnyDb = PgAsyncDatabase<any, any>;

/** Observations go on the chart two hours before `now` and the round's notes three, on every reseed, like the potassium below. */
const HOUR = 3600_000;

export async function seedDemo(db: AnyDb, now = new Date()) {
  const observedAt = new Date(now.getTime() - 2 * HOUR), notedAt = new Date(now.getTime() - 3 * HOUR);
  await db.insert(hospitals).values({ id: DEMO_HOSPITAL, name: "Demo General Hospital (synthetic)" }).onConflictDoNothing();
  // The synthetic doctor directory Sona Care's Find a doctor reads.
  await db.insert(doctors).values(DOCTORS.map(d => ({ ...d, careTeam: d.careTeam ?? false, hospitalId: DEMO_HOSPITAL })))
    .onConflictDoUpdate({ target: doctors.id, set: { days: sql`excluded.days`, times: sql`excluded.times`, room: sql`excluded.room` } });
  // The sample's reference chest film is not a source of anyone's hospital record: a patient's film is one attached to her visit.
  // The same records the app's fixtures show; the rest of each record (history, medicines, vitals, sources) is kept whole in `record`.
  // The ward's own view of each admitted patient (status, SBAR, predicted time) is kept in `record.ward`, a charted take-home list in `record.takeHome`.
  // Left out: sample mode's stand-in for the visit's rows, and the scripted consultation (no recording of the visit is saved, so the record lists none).
  await db.insert(patients).values([
    ...DEMO_PATIENTS.map(({ id, name, initials, age, sex, complaint, allergies, incomplete, encounterId: _, visit: __, ...record }) =>
      ({ id, hospitalId: DEMO_HOSPITAL, name, initials, age, sex, complaint, allergies, incomplete, record: { ...record, sources: record.sources.filter(s => s.kind !== "transcript" && s.kind !== "image") } })),
    ...WARD.map(({ id, bed: { name, initials, status, predicted, waitingHours, sbar }, age, sex, chart: { allergies, obs, note: _, ...chart } }) => {
      const [temperature, pulse, respiratoryRate, spo2, systolic, diastolic] = obs;
      return { id, hospitalId: DEMO_HOSPITAL, name: name!, initials: initials!, age, sex, complaint: sbar!.s, allergies, record: {
        ...chart, ward: { status, predicted, waitingHours, sbar },
        vitals: [{ label: "SpO₂", value: `${spo2}%` }, { label: "Temp", value: `${temperature} °C` }, { label: "Pulse", value: `${pulse} bpm` }],
        sources: [
          { id: "history", title: "Admission record", date: wardTime(notedAt), kind: "record", synthetic: true, excerpt: `Fictional admission record: ${name}, ${age}. ${sbar!.s} ${chart.history.join(". ")}. Family: ${chart.family} Social: ${chart.social} Medicines before admission: ${chart.medicines.join("; ") || "none"}. Allergy on record: ${allergies ?? "none"}.` },
          { id: "vitals", title: "Observations", date: wardTime(observedAt), kind: "record", synthetic: true, excerpt: `Fictional observations: temperature ${temperature} °C, pulse ${pulse} bpm, respiratory rate ${respiratoryRate} a minute, oxygen saturation ${spo2}%, blood pressure ${systolic}/${diastolic} mmHg.` },
        ],
      } };
    }),
  ])
    .onConflictDoUpdate({ target: patients.id, set: { complaint: sql`excluded.complaint`, allergies: sql`excluded.allergies`, incomplete: sql`excluded.incomplete`, record: sql`excluded.record` } });
  await db.insert(encounters).values([
    { id: "visit-1042", patientId: "SYN-1042", hospitalId: DEMO_HOSPITAL },
    { id: "visit-1086", patientId: "SYN-1086", hospitalId: DEMO_HOSPITAL },
  ]).onConflictDoNothing();
  // Amelia's ward record says she has been fit for an hour; the admission carries when, kept that old on every reseed like the ward's fit beds.
  await db.insert(admissions).values({ id: "adm-1042", patientId: "SYN-1042", hospitalId: DEMO_HOSPITAL, bed: "Bed 6", fitAt: new Date(now.getTime() - (DEMO_PATIENTS[0]!.ward?.waitingHours ?? 0) * HOUR) })
    .onConflictDoUpdate({ target: admissions.id, set: { fitAt: sql`excluded.fit_at` } });
  // The rest of the ward. A visit's state is only written while empty (new, or just reset), so a run's changes survive a reboot;
  // fit beds became fit `waitingHours` ago, kept that old on every reseed like the potassium below.
  await db.insert(encounters).values(WARD.map(w => ({ id: `visit-20${w.n}`, patientId: w.id, hospitalId: DEMO_HOSPITAL, state: w.state })))
    .onConflictDoUpdate({ target: encounters.id, set: { state: sql`excluded.state` }, setWhere: sql`${encounters.state} = '{}'::jsonb` });
  await db.insert(admissions).values(WARD.map(w => ({ id: `adm-20${w.n}`, patientId: w.id, hospitalId: DEMO_HOSPITAL, bed: w.bed.bed, fitAt: w.bed.status === "fit" ? new Date(now.getTime() - (w.bed.waitingHours ?? 0) * 3600_000) : null })))
    .onConflictDoUpdate({ target: admissions.id, set: { fitAt: sql`excluded.fit_at` } });
  await db.insert(guaranteeLetters).values(WARD.filter(w => w.gl).map(w => ({ id: `gl-20${w.n}`, admissionId: `adm-20${w.n}`, insurer: "Synthetic insurer", status: "requested" as const, requestedAt: now }))).onConflictDoNothing();
  // A pending result's time is when the lab logged the sample (two days ago), so it never reads as the newest result.
  await db.insert(labResults).values(WARD.flatMap(w => w.labs.map(l => ({ id: l.id, patientId: w.id, test: l.test, value: "", flag: "pending", sourceId: l.id, receivedAt: new Date(now.getTime() - 48 * 3600_000) }))))
    .onConflictDoUpdate({ target: labResults.id, set: { receivedAt: sql`excluded.received_at` } });
  await db.insert(icd10Codes).values(readCsv("icd10.csv").map(r => ({ code: r.code!, label: r.label!, chapter: r.chapter })))
    .onConflictDoUpdate({ target: icd10Codes.code, set: { label: sql`excluded.label`, chapter: sql`excluded.chapter` } });
  await db.insert(drugs).values(readCsv("drugs.csv").map(r => ({ id: r.id!, name: r.name!, ingredient: r.ingredient!, formulation: r.formulation, dose: r.dose!, sourceId: r.source_id! })))
    .onConflictDoUpdate({ target: drugs.id, set: { name: sql`excluded.name`, ingredient: sql`excluded.ingredient`, formulation: sql`excluded.formulation`, dose: sql`excluded.dose`, sourceId: sql`excluded.source_id` } });
  // Amelia's CURB-65 inputs (confusion is a 0/1 flag; AMT 10/10), each citable by its own source ID.
  const intakeAt = new Date("2026-09-22T09:26:00+08:00");
  // Confusion is the abbreviated mental test out of 10, the scale CURB-65 reads (8 or less scores).
  await db.insert(observations).values(([["confusion", 10, "AMT"], ["urea", 5.1, "mmol/L"], ["respiratory-rate", 18, "/min"], ["systolic", 124, "mmHg"], ["diastolic", 78, "mmHg"]] as const)
    .map(([kind, value, unit]) => ({ id: `obs-1042-${kind}`, patientId: "SYN-1042", kind, value, unit, sourceId: `obs-1042-${kind}`, observedAt: intakeAt })))
    .onConflictDoUpdate({ target: observations.id, set: { value: sql`excluded.value`, unit: sql`excluded.unit` } });
  // This morning's chart for everyone in a bed (Amelia's: afebrile now, as her ward record says), one row per reading.
  const chartRow = (patientId: string, kind: string, value: number, unit: string) => ({ id: `obs-${patientId.slice(4)}-${kind}`, patientId, kind, value, unit, sourceId: `obs-${patientId.slice(4)}-${kind}`, observedAt });
  await db.insert(observations).values([
    chartRow("SYN-1042", "temperature", 36.9, "°C"), chartRow("SYN-1042", "pulse", 84, "bpm"), chartRow("SYN-1042", "oxygen-saturation", 97, "%"),
    ...WARD.flatMap(w => OBS.map(([kind, unit], i) => chartRow(w.id, kind, w.chart.obs[i]!, unit))),
  ]).onConflictDoUpdate({ target: observations.id, set: { value: sql`excluded.value`, unit: sql`excluded.unit`, observedAt: sql`excluded.observed_at` } });
  // Each ward patient's saved note, in the table and shape note.save writes (one sentence per section). A note saved during
  // a run is a later revision, so it is never overwritten. Amelia's is seedDemoNote's, a step of its own (see there).
  await db.insert(notes).values(WARD.map(w => ({ id: `note-visit-20${w.n}-1`, encounterId: `visit-20${w.n}`, revision: 1, sentences: NOTE_SECTIONS.map((id, i) => ({ id, text: w.chart.note[i]! })), createdAt: notedAt })))
    .onConflictDoNothing();
  // Daniel's potassium arrived two hours ago, like the app's pending result; reseeding keeps it two hours old.
  await db.insert(labResults).values({ id: "lab-1086-potassium", patientId: "SYN-1086", test: "Potassium", value: "3.1", unit: "mmol/L", flag: "low", sourceId: "lab-1086-potassium", receivedAt: new Date(now.getTime() - 2 * 3600_000) })
    .onConflictDoUpdate({ target: labResults.id, set: { receivedAt: sql`excluded.received_at` } });
  // The synthetic insurer's rules behind the final-GL checks in the claim flow (ids match the app's check ids).
  await db.insert(insurerCriteria).values([
    { id: "severity", label: "Severity score documented", rule: { requires: "severity-score" } },
    { id: "imaging", label: "Imaging result attached", rule: { requires: "imaging-report" } },
    { id: "stay", label: "Stay within the approved plan", rule: { maxStayDays: 3 } },
    { id: "organism", code: "J18.9", label: "Organism documented", rule: { requires: "organism-statement" } },
    { id: "iv", label: "Reason for IV antibiotics", rule: { requires: "iv-reason" } },
  ].map(c => ({ ...c, id: `synthetic-${c.id}`, insurer: "Synthetic insurer" }))).onConflictDoNothing();
  // SYNTHETIC casemix weights for the coding-audit codes on an RM 4,500 base rate, picked so the
  // weight gaps roughly reproduce the audit screen's amounts at risk. Not real MY-DRG values.
  const weights: Record<string, number> = {
    "J18.9": 0.92, N10: 0.85, "B96.2": 0.41, "K35.8": 0.8, "K35.3": 1.32, "I50.9": 1.05, "I50.0": 1.52, I64: 1.2, "I63.9": 1.88, "L03.9": 0.62, "L03.1": 0.79,
    "D64.9": 0.14, "J44.9": 0.88, "J44.1": 1.16, "E87.1": 0.21, "N17.9": 0.34, "A41.9": 1.4, "A41.5": 1.86, "J45.9": 0.7, J46: 0.96,
  };
  await db.insert(casemixWeights).values(Object.entries(weights).map(([code, weight]) => ({ code, weight, baseRateCents: 450_000 })))
    .onConflictDoUpdate({ target: casemixWeights.code, set: { weight: sql`excluded.weight`, baseRateCents: sql`excluded.base_rate_cents` } });
  // Today's visits, 15 and 45 minutes from `now` like the app's demo slots; reseeding moves them to the new today.
  await db.insert(appointments).values(([["SYN-1042", 15], ["SYN-1086", 45]] as const).map(([patientId, minutes]) => (
    { id: `appt-${patientId}`, patientId, hospitalId: DEMO_HOSPITAL, kind: "clinic visit", startsAt: new Date(now.getTime() + minutes * 60_000) })))
    .onConflictDoUpdate({ target: appointments.id, set: { startsAt: sql`excluded.starts_at` } });
  await db.insert(guaranteeLetters).values({ id: "gl-1042", admissionId: "adm-1042", insurer: "Synthetic insurer", status: "requested", requestedAt: new Date("2026-09-25T09:40:00+08:00") }).onConflictDoNothing();
  // Daniel's note and a haemoglobin the note does not mention: the coding audit's worked example.
  await db.insert(notes).values({ id: "note-1086-1", encounterId: "visit-1086", revision: 1, sentences: [{ id: "s1", text: "Breathless on exertion; onset not yet documented." }, { id: "s2", text: "Tablet reported; ingredient unknown." }], createdAt: notedAt }).onConflictDoNothing();
  await db.insert(labResults).values({ id: "lab-hb-1086", patientId: "SYN-1086", test: "Hb", value: "9.8", unit: "g/dL", flag: "low", sourceId: "lab-hb-1086", receivedAt: new Date(now.getTime() - 26 * 3600_000) }).onConflictDoNothing();
  // Demo flow 6: follow-up intervals are looked up from this table, never generated.
  const num = (v?: string) => (v ? Number(v) : null);
  await db.insert(followUpRules).values(readCsv("follow-up-rules.csv").map(r => ({
    id: r.id!, kind: r.kind as "nodule", riskBand: r.risk_band as "low", minMm: num(r.min_mm), maxMm: num(r.max_mm),
    intervalDays: num(r.interval_days), action: r.action!, source: r.source!,
  }))).onConflictDoUpdate({ target: followUpRules.id, set: { intervalDays: sql`excluded.interval_days`, action: sql`excluded.action`, source: sql`excluded.source`, minMm: sql`excluded.min_mm`, maxMm: sql`excluded.max_mm` } });
}

/**
 * Amelia's saved note for her stay, in the table and shape note.save writes (revision 1, one sentence per section), so her
 * discharge and guarantee letter build on a real saved note. Like Nurul's it leaves the insurer's two open questions (the
 * organism, why IV came first) for the doctor: the seed answers nothing on the doctor's behalf. Safe to rerun; a note saved
 * during a run is a later revision and is never overwritten.
 * ponytail: its own step, run by the seed and the reset (seed-run.ts, reset.ts) and not inside seedDemo, because the API's
 * tests seed with seedDemo and many start from Amelia with no note; move it into seedDemo once those tests expect her note.
 */
export async function seedDemoNote(db: AnyDb, now = new Date()) {
  await db.insert(notes).values({ id: "note-visit-1042-1", encounterId: "visit-1042", revision: 1, sentences: NOTE_SECTIONS.map((id, i) => ({ id, text: AMELIA_NOTE[i]! })), createdAt: new Date(now.getTime() - 3 * HOUR) })
    .onConflictDoNothing();
}

/**
 * TEST_PATIENT as a real Sona Care account: the user (email verified, the demo phone verified), an
 * email-and-password login, and the link to Amelia's record. Safe to rerun: an account that already
 * exists (even one signed up in the app) is reused, and a stray account holding the demo phone gives it up.
 */
export async function seedTestPatient(db: AnyDb) {
  const { email, name, password, phone, patientId } = TEST_PATIENT;
  const id = await demoUser(db, "test-patient-amelia", name, email);
  await db.update(user).set({ phoneNumber: null, phoneNumberVerified: null }).where(and(eq(user.phoneNumber, phone), ne(user.id, id)));
  await db.update(user).set({ phoneNumber: phone, phoneNumberVerified: true }).where(eq(user.id, id));
  await credential(db, id, password);
  await db.insert(careLinks).values({ userId: id, hospitalId: DEMO_HOSPITAL, patientId }).onConflictDoNothing();
  return id;
}

/**
 * The user row for a demo login, by its email. A user still on the account's legacy address (signed up on staging
 * before the memorable usernames) is renamed to the new one so its data stays with it; otherwise the row is made.
 */
async function demoUser(db: AnyDb, seeded: string, name: string, email: string) {
  const byEmail = async (address: string) => (await db.select({ id: user.id }).from(user).where(eq(user.email, address)))[0]?.id;
  const legacy = LEGACY_EMAILS[email] && !(await byEmail(email)) ? await byEmail(LEGACY_EMAILS[email]) : undefined;
  if (legacy) await db.update(user).set({ email }).where(eq(user.id, legacy));
  await db.insert(user).values({ id: seeded, name, email, emailVerified: true }).onConflictDoNothing();
  return (await byEmail(email))!;
}

/**
 * An email-and-password login for a seeded user. An existing login keeps its row id but gets the constant's hash on every
 * run: demo passwords must be what the slide says, every time, even after someone changed one in the app.
 */
async function credential(db: AnyDb, id: string, password: string) {
  const hash = await hashPassword(password);
  const [login] = await db.select({ id: account.id }).from(account).where(and(eq(account.userId, id), eq(account.providerId, "credential")));
  if (login) await db.update(account).set({ password: hash }).where(eq(account.id, login.id));
  else await db.insert(account).values({ id: `credential-${id}`, accountId: id, providerId: "credential", userId: id, password: hash });
}

/**
 * Every synthetic staff login (the four role accounts and the two handover colleagues) as real accounts, made as
 * seedTestPatient makes Amelia's, that are members of the demo hospital without a first sign-in: handover.receivers (the
 * members who may accept, the caller left out) is then never empty for the demo doctor. Safe to rerun: a user or a
 * membership that exists is kept, its password reset.
 */
export async function seedTestStaff(db: AnyDb) {
  for (const { id: seeded, name, email, password, role } of [TEST_DOCTOR, TEST_NURSE, TEST_BED_MANAGER, TEST_MANAGER, TEST_DOCTOR_2, TEST_NURSE_2]) {
    const id = await demoUser(db, seeded, name, email);
    await credential(db, id, password);
    await db.insert(hospitalMembers).values({ userId: id, hospitalId: DEMO_HOSPITAL, role }).onConflictDoNothing();
  }
}

/** The library's own ingest (packages/retrieval's, which imports this package, so it comes in here as it does into the API's context). */
type Ingest = (doc: { id: string; hospitalId: string; title: string; source: string; year: number; kind: "leaflet" }, text: string) => Promise<number>;
/**
 * The hospital's patient leaflets in its library: its general leaflets by condition (PATIENT_LEAFLETS, the ones a
 * discharge picks from), one document per leaflet and language, stored and indexed as every library source is (`ingest`)
 * and marked kind "leaflet", source "Patient leaflet": the only documents a Sona Care answer may read. Each is one
 * section, headed by the diagnosis and holding the leaflet word for word. Safe to rerun: a document's id is its
 * leaflet and language, so it is replaced, and no upload can take that id (library.ts refuses another's document).
 * Run by packages/retrieval's seed-run.ts, where the library's ingest lives. Returns how many it stored.
 * ponytail: a leaflet's language rides on its id (":en"), which is how an answer picks her language's copy
 * (packages/api/src/leaflets.ts); give documents a language column with the next migration.
 */
export async function seedLeaflets(ingest: Ingest, hospitalId = DEMO_HOSPITAL) {
  for (const leaflet of PATIENT_LEAFLETS) for (const { id: language, name } of LANGUAGES) {
    await ingest({ id: `${hospitalId}:leaflet:${leaflet.id}:${language}`, hospitalId, title: leaflet.title[language], source: `Patient leaflet (${name})`, year: 2026, kind: "leaflet" }, `# ${leaflet.about}\n${leaflet.text[language]}`);
  }
  return PATIENT_LEAFLETS.length * LANGUAGES.length;
}

/** Rows of a reference file in the repo's data/ folder; `#` lines are provenance notes, quoted fields may hold commas. */
function readCsv(file: string): Record<string, string>[] {
  const lines = readFileSync(fileURLToPath(new URL(`../../../data/${file}`, import.meta.url).href), "utf8").split("\n").filter(l => l.trim() && !l.startsWith("#"));
  const split = (l: string) => [...l.matchAll(/("([^"]*)"|[^,]*)(,|$)/g)].slice(0, -1).map(m => m[2] ?? m[1]!);
  const [header, ...rows] = lines.map(split);
  return rows.map(r => Object.fromEntries(header!.map((h, i) => [h, r[i]!])));
}
