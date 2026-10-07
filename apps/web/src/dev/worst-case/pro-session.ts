import { fixture, rows } from "./fixture";

// Seeds every Pro page needs: who is signed in, and the frame's sidebar badges. A page's own fixture file
// (pro-<page>.ts) that registers one of the badge procedures replaces the seed here.
const NAMES = ["Christopher Alexander Montgomery III", "Jo", "Đặng Thị Ngọc Hân", "王秀英", "Siti Nur Aisyah binti Mohd Khairuddin", "Seán O'Brien-Ó Súilleabháin"];
const name = (i: number) => NAMES[i % NAMES.length]!;
const at = (i: number) => new Date(Date.UTC(2026, 9, 7, 1, 0) - i * 37 * 60_000);

const task = (i: number) => ({
  id: `t-${i}`, hospitalId: "h-ukm", encounterId: `e-${i % 40}`, kind: "followup" as const, owner: "Dr Aleksandra Wiśniewska-Kowalczyk",
  title: `Chase the repeat potassium for ${name(i)} before the 4 pm ward round`, due: null, completed: false,
  sourceId: null, idempotencyKey: null, createdAt: at(i),
});
const result = (i: number) => ({
  id: `r-${i}`, patientId: `p-${i % 40}`, patientName: name(i), test: "Serum potassium", value: "6.8", unit: "mmol/L", flag: "high",
  critical: i % 3 === 0, why: undefined, receivedAt: at(i), acknowledgedBy: null, acknowledgedAt: null, acknowledgedByName: null,
});
const thread = (i: number) => ({
  patientId: `p-${i}`, name: name(i), initials: "CM", bed: `4B-${i + 1}`, lastText: "Chest feels tight again since this morning",
  lastFrom: "patient" as const, lastAt: at(i), lastPhoto: null, waitingSince: at(i), waiting: 1, unread: 1, label: null, reason: null, handled: false,
});
const inbox = (n: number) => ({ now: at(0), threads: rows(n, thread) });
const summary =(i: number) => ({
  id: `vs-${i}`, kind: "visit-summary" as const, patient: { id: `p-${i}`, name: name(i) }, encounterId: `e-${i}`,
  text: "Your potassium was high, so we stopped the spironolactone.", whatChanged: [], sources: [], checks: [], origin: "model" as const, createdAt: at(i),
});
// Encounters for pages that open a visit from a patient id (/pro/today, /pro/schedule); /pro/patients' own file replaces it.
// p-3 and p-9 have no visit record yet.
const patient = (i: number) => ({
  id: `p-${i}`, encounterId: i === 3 || i === 9 ? "" : `e-${i}`, name: name(i), initials: "CM", age: 30 + i, sex: i % 2 ? "F" : "M",
  subtitle: "", complaint: "Chest tightness", history: [], family: "", social: "", allergies: null, medicines: [], vitals: [], sources: [], incomplete: i % 4 === 0,
});
const lists = <T,>(row: (i: number) => T, worst: number) => ({ worst: rows(worst, row), empty: [], one: rows(1, row), huge: rows(1000, row) });

export default [
  fixture("clinician.me", {
    worst: {
      userId: "u-9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f",
      name: "Dr Aleksandra Wiśniewska-Kowalczyk",
      email: "aleksandra.wisniewska-kowalczyk@hospital-pakar-ukm.example.com",
      role: "doctor",
      // ROLE_LABEL says "Doctor" today; the field is a plain string, so a hospital's own title fits here too.
      label: "Consultant Cardiothoracic and Vascular Surgeon",
    },
    one: { userId: "u-jo", name: "Jo", email: "jo@example.com", role: "doctor", label: "Doctor" },
  }),
  fixture("tasks.list", lists(task, 1284)),
  fixture("results.list", lists(result, 37)),
  fixture("messages.inbox", { worst: inbox(12), empty: inbox(0), one: inbox(1), huge: inbox(1000) }),
  fixture("patients.list", lists(patient, 40)),
  fixture("review.list", lists(summary, 3)),
];
