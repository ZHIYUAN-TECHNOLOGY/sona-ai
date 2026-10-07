import { fixture, rows } from "./fixture";

// Settings: the clinician's watches (5 is the cap, MAX_WATCHES; 25 tests a list past it) and the demo clock.
const QUESTIONS = [
  "Every morning at 7, which of my patients on Wad Perubatan Lelaki 4B (Kardiologi) have a potassium result above 5.5 mmol/L or a creatinine that rose by more than 26.5 µmol/L in 48 hours, and has anyone acted on it yet?",
  "Sepsis?",
  "Siapa yang belum ada keputusan kultur darah selepas 48 jam?",
  "每天早上 8 点，哪些病人的 INR 超过 3？",
  "Who is waiting on a guarantee letter from Allianz General Insurance Company (Malaysia) Berhad for more than 6 hours?",
];
const spec = {
  root: "r", elements: {
    r: { type: "AskAnswer", props: {}, children: ["l", "rows"] },
    l: { type: "AskLead", props: { text: "3 patients have a potassium above 5.5 mmol/L and nobody has acted on 2 of them since the 06:40 results." } },
    rows: { type: "AskRows", props: { rows: [
      { title: "Siti Nur Aisyah binti Mohd Khairuddin", detail: "K 6.8 mmol/L at 06:40, no task, no repeat ordered; bed 4B-12, Wad Perubatan Lelaki 4B (Kardiologi)" },
      { title: "Jo", detail: "" },
      { title: "Christopher Alexander Montgomery III", detail: "K 5.6 mmol/L, repeat booked for 10:00" },
    ] } },
  },
};
const at = new Date(Date.UTC(2026, 9, 7, 0, 0)).toISOString();
const LAST = [
  { at, source: "model", model: "gemma-3-27b", spec },
  null,
  { at, source: "fixture", unanswered: true },
  { at, source: "fixture", waking: 300 },
  { at, source: "fixture", waking: 300, retried: true },
];
const watch = (i: number) => ({ id: `w-${i}`, question: QUESTIONS[i % QUESTIONS.length]!, hour: [7, 0, 23, 12, 13][i % 5]!, createdAt: at, last: (LAST[i % LAST.length] ?? null) as never }); // `last` is read loosely on the page too

const clock = (offsetMs: number, discharged: string | null) => ({
  offsetMs, now: new Date(Date.UTC(2026, 9, 14, 1, 0)), dischargedAt: discharged ? new Date(discharged) : null, checkInDays: [2, 14],
  available: discharged ? ["now" as const, "day-1" as const, "day-2" as const, "day-7" as const, "visit" as const] : ["now" as const],
});

export default [
  fixture("watches.list", { worst: rows(5, watch), empty: [], one: [watch(1)], huge: rows(25, watch) }),
  fixture("demo.status", { worst: clock(1_284 * 86_400_000 + 37 * 60_000, "2026-10-06T23:30:00.000Z"), one: clock(86_400_000, "2026-10-13T01:00:00.000Z"), empty: clock(0, null) }),
];
