import type { HandoverCard } from "@sona-ai/domain/handover";

import { fixture, rows } from "./fixture";
import { nameOf } from "./pro-ward";

// /pro/handover: 40 cards (a full medical ward at shift change), every SBAR field at its realistic longest.
const META = ["84 · Female · Bed 12A (Isolation, side room)", "19 · Male · Bed 3", "101 · Male · Bed 7", "45 · Female · Bed 8", "67 · Female · HDU 2", "33 · Female · Bed 10",
  "58 · Female", "72 · Male · Bed 21", "40 · Male · Bed 22", "", "34 · Male · Bed 24", "29 · Female · Bed 25"];
const TODO = [
  "Repeat serum potassium at 22:00; if above 6.0 mmol/L give calcium gluconate 10% 10 mL IV and call the on-call medical registrar",
  "Chase the final guarantee letter from Great Eastern Takaful Berhad (Corporate Panel, Petronas Dagangan)",
  "Hold enoxaparin tonight",
  "Fluid balance chart: target negative 1 L by 08:00",
  "Blood cultures ×2 if febrile above 38.0 °C",
  "Review warfarin dose with INR in the morning",
  "Daughter (Nurul) is the next of kin: call 012-345 6789 before 21:00 with any change",
  "Benachrichtigungseinstellungen für Angehörige prüfen",
];
const card = (i: number): HandoverCard => {
  const long = i % 4 === 0;
  return {
    id: `h-${i}`, patientId: `p-${i}`, name: nameOf(i), meta: META[i % META.length]!, priority: i % 3 === 0 ? "watch" : "stable",
    situation: long
      ? "Day 6 of IV piperacillin-tazobactam for hospital-acquired pneumonia; new atrial fibrillation with rapid ventricular response at 16:40, rate now 110 after IV metoprolol 2.5 mg ×2, still short of breath on 4 L nasal prongs"
      : i % 4 === 1 ? "Stable." : "Day 2 of IV antibiotics for cellulitis of the left leg; afebrile since 06:00.",
    background: long
      ? "Type 2 diabetes on insulin glargine 24 units nightly, chronic kidney disease stage 4 (eGFR 18), ischaemic heart disease with a drug-eluting stent to the LAD in 2019, previous upper GI bleed on aspirin; penicillin allergy listed as rash but tolerated piperacillin this admission"
      : "Hypertension.",
    assessment: long
      ? "Potassium 6.8 mmol/L at 18:00 with peaked T waves; lactate 3.4; looks unwell but talking in full sentences. NEWS2 7."
      : "Improving.",
    recommendation: long ? TODO : i % 4 === 1 ? [] : [TODO[i % TODO.length]!],
    sources: long ? rows(23, j => `src-${i}-${j}`) : i % 4 === 1 ? [] : [`src-${i}`],
  };
};
const RECEIVERS = [
  { id: "u-1", name: "Dr Christopher Alexander Montgomery III", role: "doctor" as const },
  { id: "u-2", name: "Jo", role: "nurse" as const },
  { id: "u-3", name: "Siti Nur Aisyah binti Mohd Khairuddin", role: "nurse" as const },
  { id: "u-4", name: "Đặng Thị Ngọc Hân", role: "doctor" as const },
];

export default [
  fixture("handover.list", { worst: rows(40, card), empty: [], one: [card(0)], huge: rows(1000, card) }),
  fixture("handover.receivers", { worst: RECEIVERS, empty: [], one: [RECEIVERS[1]!] }),
  // The server's acceptance row, echoing what was sent.
  fixture("handover.accept", {
    worst: input => ({ id: "ha-1", hospitalId: "h-ukm", fromUser: "u-9", toUser: input.toUser, cardIds: input.cardIds, requestId: input.requestId, acceptedAt: new Date() }),
  }),
];
