import { fixture, rows } from "./fixture";

// /pro/visit (today's visits: day.list in pro-today.ts) and /pro/visit?encounterId=visit-1001 (patients.list is in pro-patients.ts, the briefing in
// pro-patient.ts). Note sentences, medicine entries and appointment kinds are unbounded text (`notes.sentences` jsonb,
// `appointments.kind` text); the scribe's transcript lines are capped at 4,000 characters (toLines), the size used here.
const NOW = Date.UTC(2026, 9, 7, 1, 0);

// A history section dictated in full: 4,000 characters, the longest line the scribe accepts.
const HISTORY = (
  "67-year-old woman with HFrEF (EF 30%), CKD 3b, COPD GOLD 3 and type 2 diabetes, brought in by her son with three days of increasing breathlessness, " +
  "orthopnoea on three pillows, paroxysmal nocturnal dyspnoea twice, a productive cough of green sputum and fevers to 38.9 °C at home. " +
  "She stopped her furosemide a week ago because of urinary frequency on the bus to her daughter's house in Seremban, and has missed most of her bedtime insulin glargine on weekends. " +
  "No chest pain, no haemoptysis, no calf pain. Ankle swelling to mid-shin. Weight up 4 kg in a week on her home scale. "
).repeat(9).slice(0, 4000);

const SENTENCES = [
  { id: "subjective", text: HISTORY },
  { id: "objective", text: "T 38.4 °C, HR 128 irregular, BP 182/104, RR 28, SpO₂ 88% on 4 L.\nJVP +6 cm. Bibasal crackles to the mid zones; pitting oedema to mid-shin." },
  { id: "assessment", text: "Pneumonia." },
  { id: "plan", text: "" },
  { id: "s-addendum", text: "Addendum 14:20: son asks for a family meeting with Dr Aleksandra Wiśniewska-Kowalczyk before any decision on the ICU referral." },
];

const MEDS = [
  "Insulin glargine (Lantus SoloStar) 100 units/mL pre-filled pen", "Metformin XR", "Empagliflozin", "Furosemide", "Spironolactone", "Bisoprolol",
  "Budesonide/formoterol (Symbicort Turbuhaler) 160/4.5 mcg", "Tiotropium", "Atorvastatin", "Aspirin", "Allopurinol", "Levothyroxine",
  "Ubat batuk cap ibu (traditional cough syrup, ingredient unknown)", "Omeprazole", "Paracetamol", "Gabapentin", "Sertraline", "Amlodipine", "Perindopril", "Clopidogrel",
];
const entry = (i: number) => ({
  id: `med-${i}`, name: MEDS[i % MEDS.length]!, ingredient: i % 13 === 12 ? "" : MEDS[i % MEDS.length]!.split(" ")[0]!.toLowerCase(),
  formulation: i % 7 === 3 ? "" : i % 2 ? "tablet" : "modified-release tablet", confirmed: i % 4 !== 1,
  ...(i === 4 ? { change: "stopped" as const } : i === 0 ? { change: "changed" as const, from: "16 units at bedtime" } : {}),
});

const PROPOSED = "Co-amoxiclav 1.2 g powder for injection, 1.2 g intravenous every 8 hours for 7 days, for community-acquired pneumonia";

// Writes answer with the visit as the server would return it, so the page's cache never holds an empty `{}` snapshot.
const snapshot = ({ encounterId }: { encounterId: string }) => ({
  encounterId, revision: 1285,
  state: { medicationEntries: rows(40, entry), proposedMedicine: PROPOSED, medicationCheckedRevision: 1285 },
});

export default [
  fixture("encounter.edit", { worst: snapshot }),
  fixture("encounter.recordReview", { worst: snapshot }),
  fixture("prescribing.review", { worst: snapshot }),
  fixture("note.save", { worst: ({ encounterId, sentences }) => ({ encounterId, revision: 1285, sentences }) }),
  fixture("note.draft", {
    worst: {
      source: "fixture", dropped: 1284, turns: [],
      sections: { subjective: HISTORY.slice(0, 1200), objective: "", assessment: "Community-acquired pneumonia, CURB-65 score 3, with acute decompensated heart failure and acute kidney injury on CKD 3b.", plan: "IV furosemide 80 mg twice daily; switch co-amoxiclav to IV ceftriaxone 2 g once daily and oral clarithromycin 500 mg twice daily given the penicillin anaphylaxis; strict input/output; daily U&E." },
    },
  }),
  fixture("prescribing.simulate", {
    worst: {
      id: "rx-1285", kind: "prescription", encounterId: "visit-1001", approvedBy: "u-9f8e7d6c", createdAt: new Date(NOW), revision: 1285, requestId: "web-rx-visit-1001-r1285-9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f", approvedByName: "Dr Aleksandra Wiśniewska-Kowalczyk",
      payload: { medication: "Ceftriaxone", dose: "2", unit: "g", route: "intravenous", frequency: "once daily", duration: "7 days", indication: "community-acquired pneumonia with a penicillin anaphylaxis on record", sourceVersion: "Malaysian CPG Management of Pneumonia in Adults, 3rd edition (2024) · v3.2", checks: rows(11, (i) => `check-${i}`) },
    },
  }),
  fixture("note.get", {
    worst: ({ encounterId }) => ({ encounterId, revision: 1284, sentences: SENTENCES }),
    empty: ({ encounterId }) => ({ encounterId, revision: 0, sentences: [] }),
    one: ({ encounterId }) => ({ encounterId, revision: 1, sentences: [{ id: "assessment", text: "Viral URTI." }] }),
  }),
  fixture("encounter.get", {
    worst: ({ encounterId }) => ({
      encounterId, revision: 1284,
      state: { medicationEntries: rows(40, entry), proposedMedicine: PROPOSED, reviewInvalidated: true, medicationCheckedRevision: 1283 },
    }),
    empty: ({ encounterId }) => ({ encounterId, revision: 0, state: { medicationEntries: [] } }),
    one: ({ encounterId }) => ({ encounterId, revision: 1, state: { medicationEntries: rows(1, entry), proposedMedicine: "Paracetamol 1 g tablet, 1 g oral every 6 hours for 3 days, for fever" } }),
  }),
];
