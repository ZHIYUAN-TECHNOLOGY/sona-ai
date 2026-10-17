// Every answer card kind (@sona-ai/domain/answer-parts) with Sona content, for the dev gallery and the cards' render test.
// Synthetic: Amelia Tan and Dr. Lim are the demo's people. Each list is one answer's worth (at most 6 cards, one action).
import type { AnswerCard } from "@sona-ai/domain/answer-parts";

/** A patient's answer: her medicine, a result, a home reading, her next visit, a doctor, then how to book. */
export const CARE_FACTS: AnswerCard[] = [
  { type: "medicine", name: "Azithromycin", dose: "500 mg", how: "After food", times: ["08:00"], note: "3 more days", source: "Your discharge plan" },
  { type: "result", test: "Potassium", value: "3.1", unit: "mmol/L", flag: "low", range: "3.5 to 5.1 mmol/L", at: "2026-10-09T00:30:00.000Z", source: "Lab result" },
  { type: "reading", label: "Blood pressure", value: "150/95", unit: "mmHg", flag: "high", at: "2026-10-10T23:00:00.000Z" },
  { type: "appointment", title: "Clinic review with Dr. Lim", when: "2026-10-26T01:00:00.000Z", where: "Clinic 3B, Level 2", status: "confirmed" },
  { type: "doctor", id: "lim", name: "Dr. Lim Wei Jie", specialty: "Respiratory", room: "Clinic 3B", rating: 4.8, careTeam: true },
  {
    type: "action", do: "book", title: "Clinic review with Dr. Lim", items: ["Mon, 26 Oct, 9:00 am", "Clinic 3B, Level 2"],
    what: "Your care team confirms it, usually within a day.", confirm: "Request this visit", done: "Requested. Your care team will confirm it.",
    payload: { doctorId: "lim", startsAt: "2026-10-26T01:00:00.000Z", reason: "Review after pneumonia" },
  },
];

/** A patient's answer with the plan's warning signs, the steps to follow, and a dose to log. */
export const CARE_STEPS: AnswerCard[] = [
  { type: "warning", level: "soon", title: "Call your care team if", items: ["Your fever comes back", "You cough up green or bloody phlegm"] },
  { type: "warning", level: "info", title: "Normal for the first week", items: ["A mild cough", "Feeling tired after walking"] },
  { type: "steps", title: "Using your inhaler", items: ["Shake it and take the cap off", "Breathe out gently", "Press once as you breathe in slowly", "Hold your breath for 10 seconds"] },
  { type: "action", do: "logDose", title: "Azithromycin 500 mg, 8:00 am", what: "Marks today's morning dose as taken.", confirm: "Mark as taken", done: "Marked as taken at 8:12 am.", payload: { key: "Azithromycin@2026-10-11T00:00:00.000Z" } },
];

/** A clinician's answer: a critical result, a ward reading, a prescription, a visit, the must-not-miss signs and a task. */
export const PRO_CARDS: AnswerCard[] = [
  { type: "result", test: "Potassium", value: "6.4", unit: "mmol/L", flag: "critical", range: "3.5 to 5.1 mmol/L", at: "2026-10-11T22:00:00.000Z", source: "Lab result" },
  { type: "reading", label: "SpO2", value: "91", unit: "%", flag: "low", at: "2026-10-11T23:30:00.000Z" },
  { type: "medicine", name: "Co-amoxiclav", dose: "625 mg", how: "Oral, with food", times: ["08:00", "14:00", "20:00"], source: "This visit's prescription" },
  { type: "appointment", title: "Respiratory review", when: "2026-10-12T03:00:00.000Z", where: "Ward 4B", status: "due-soon" },
  { type: "warning", level: "urgent", title: "Act now", items: ["Potassium 6.4 mmol/L: repeat and get an ECG", "SpO2 91% on room air"] },
  {
    type: "action", do: "createTask", title: "Repeat potassium and ECG for Amelia Tan", items: ["Owner: Dr. Lim", "Due today"],
    what: "Adds a task on her visit; the owner is told.", confirm: "Create task", done: "Task created for Dr. Lim.",
    payload: { encounterId: "enc-demo", title: "Repeat potassium and ECG", owner: "Dr. Lim", due: "2026-10-12" },
  },
];
