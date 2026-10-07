import type { Bed } from "@sona-ai/domain/ward";

import { fixture, rows } from "./fixture";

// /pro/ward (and the discharge picker, which ranks from the same beds). Patient ids are `p-<i>` and visits `e-<i>`,
// as in pro-session.ts, so the patients list and every other page's rows line up with the same people.
export const NAMES = [
  "Aleksandra Wiśniewska-Kowalczyk", "Jo", "Christopher Alexander Montgomery III", "نور الهدى عبد الرحمن", "王秀英", "Đặng Thị Ngọc Hân",
  "Siti Nur Aisyah binti Mohd Khairuddin", "Muthukumaran a/l Subramaniam Pillai", "Seán O'Brien-Ó Súilleabháin", "🦊 Fox", "Lim Wei Jie", "Priya Nair",
];
export const nameOf = (i: number) => NAMES[i % NAMES.length]!;
const META = ["84 · Female", "19 · Male", "101 · Male", "45 · Female", "67 · Female", "33 · Female", "58 · Female", "72 · Male", "40 · Male", "", "34 · Male", "29 · Female"];

type Blocker = Bed["blockers"][number];
const x = (id: string, kind: Blocker["kind"], label: string, detail = ""): Blocker => ({ id, kind, label, detail });
// Nine at once on one bed: every kind, long labels, long and empty details.
const NINE: Blocker[] = [
  x("w0-gl", "gl", "Final guarantee letter", "Great Eastern Takaful Berhad (Corporate Panel, Petronas Dagangan) · requested 08:10, chased 11:40 and 14:05"),
  x("w0-cult", "result", "Urine culture and sensitivities, repeat sample after contamination"),
  x("w0-pharm", "pharmacy", "Take-home medicines", "14 items · 3 changed · 2 new · 1 stopped · insulin pen counselling not yet done"),
  x("w0-ride", "transport", "Ride home", "Family free after 17:00; needs a wheelchair-accessible vehicle"),
  x("w0-book", "booking", "Follow-up booking", "Cardiothoracic and vascular surgery clinic, about 2 weeks"),
  x("w0-hb", "result", "Repeat haemoglobin and iron studies before the transfusion decision", "Lab expects by 16:30"),
  x("w0-nh", "transport", "Transfer to Rumah Seri Kenangan nursing home, Cheras", "Waiting for a bed"),
  x("w0-gl2", "gl", "Benachrichtigungseinstellungen"),
  x("w0-echo", "booking", "Echocardiogram before discharge", "Earliest slot Thursday 09:00"),
];
const first: Bed[] = [
  { bed: "Bed 12A (Isolation, side room)", patientId: "p-0", name: nameOf(0), meta: META[0], status: "fit", predicted: "Awaiting nursing home placement (Rumah Seri Kenangan, Cheras)", blockers: NINE },
  { bed: "Bed 3", patientId: "p-1", name: nameOf(1), meta: META[1], status: "watch", predicted: "Tomorrow", blockers: [] },
  { bed: "Bed 7", patientId: "p-2", name: nameOf(2), meta: META[2], status: "fit", predicted: "11:00", blockers: [x("w2", "result", "Repeat haemoglobin and iron studies before transfusion decision", "Lab expects by 12:00")] },
  { bed: "Bed 8", patientId: "p-3", name: nameOf(3), meta: META[3], status: "stable", predicted: "In 2 days", blockers: [] },
  { bed: "HDU 2", patientId: "p-4", name: nameOf(4), meta: META[4], status: "fit", predicted: "", blockers: [x("w4", "transport", "Ride home")] },
  { bed: "Bed 10", patientId: "p-5", name: nameOf(5), meta: META[5], status: "watch", predicted: "Once cleared", blockers: [x("w5", "booking", "Benachrichtigungseinstellungen")] },
  { bed: "Bed 11", patientId: "p-9", name: nameOf(9), status: "stable", predicted: "Tomorrow", blockers: [] },
  { bed: "Bed 14", status: "free", predicted: "", blockers: [] },
  { bed: "Bed 15", status: "empty", predicted: "Cleaning · ready 12:30", blockers: [] },
];
const STATUSES = ["fit", "watch", "stable", "fit", "free"] as const;
const bed = (i: number): Bed => {
  const status = STATUSES[i % STATUSES.length]!;
  if (status === "free") return { bed: `Bed ${i + 20}`, status, predicted: "", blockers: [] };
  return {
    bed: `Bed ${i + 20}`, patientId: `p-${i}`, name: nameOf(i), meta: META[i % META.length], status, predicted: i % 3 ? "Tomorrow" : "14:30",
    blockers: i % 4 ? [] : [x(`b${i}-gl`, "gl", "Final guarantee letter", "Synthetic TPA · requested 08:10")],
  };
};
// The worst ward: 60 beds, the named failures first.
export const WORST_BEDS: Bed[] = [...first, ...rows(60 - first.length, i => bed(i + first.length))];

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 7, h - 8, m));
const forecast = (beds: Bed[]) => {
  const timeline = beds.filter(b => b.name && b.status !== "watch").map((b, i) => ({
    bed: b.bed, name: b.name, at: at(9 + (i % 12), (i * 7) % 60), confidence: (["high", "medium", "low"] as const)[i % 3]!, reasons: b.blockers.map(x => x.label),
  }));
  return {
    now: at(8), midnight: at(24), today: { count: timeline.length, byTime: "5 pm" }, tomorrow: { count: 1284 }, timeline,
    unlock: timeline.length ? { bed: beds[0]!.bed, blockerId: "w0-gl", label: "Final guarantee letter", owner: "Billing" as const, owned: false, hours: 1284,
      line: `${beds[0]!.bed}: the final guarantee letter from Great Eastern Takaful Berhad frees 1,284 bed-hours if Billing chases it before 17:00` } : undefined,
    label: `${timeline.length} beds free by 5 pm`,
  };
};
const brief = (lines: string[]) => ({ lines, source: "model" as const, model: "medgemma-27b" });

export default [
  fixture("ward.beds", { worst: WORST_BEDS, empty: [], one: [first[0]!], huge: rows(1000, bed) }),
  fixture("ward.forecast", { worst: forecast(WORST_BEDS), empty: forecast([]), one: forecast([first[0]!]), huge: forecast(rows(1000, bed)) }),
  fixture("ward.huddle", {
    worst: brief([
      "Bed 12A (Isolation, side room) holds nine discharge barriers, five of them unassigned; the final guarantee letter from Great Eastern Takaful Berhad has been chased twice since 08:10.",
      "Christopher Alexander Montgomery III in Bed 7 is medically fit and waits only on a repeat haemoglobin, expected by 12:00.",
      "Twelve beds are forecast to free up before 17:00; nursing home placement is the longest wait on the ward.",
      "王秀英 in HDU 2 needs a ride home after 17:00.",
    ]),
    empty: brief([]),
    one: brief(["Bed 12A has one patient and nine discharge barriers."]),
  }),
  fixture("ops.get", {
    worst: { since: at(-160), now: at(8), bedMinutesSaved: 128460, discharges: 1284, redFlags: 1284, redFlagsActedOn: 1283, medianMinutesToBook: null,
      checkInsSent: 12840, checkInsAnswered: 9999, lostFollowUps: 0, trackedFollowUps: 1, dosesDue: 0, dosesTaken: 0 },
    empty: { since: at(-160), now: at(8), bedMinutesSaved: 0, discharges: 0, redFlags: 0, redFlagsActedOn: 0, medianMinutesToBook: null,
      checkInsSent: 0, checkInsAnswered: 0, lostFollowUps: 0, trackedFollowUps: 0, dosesDue: 0, dosesTaken: 0 },
    one: { since: at(-160), now: at(8), bedMinutesSaved: 1, discharges: 1, redFlags: 1, redFlagsActedOn: 1, medianMinutesToBook: 1,
      checkInsSent: 1, checkInsAnswered: 1, lostFollowUps: 1, trackedFollowUps: 1, dosesDue: 1, dosesTaken: 1 },
  }),
];
