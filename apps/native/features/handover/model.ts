import { buildHandover as build, type HandoverCard } from "@sona-ai/domain/handover";
import type { Encounter, Patient } from "@/features/encounter/types";
import { PENDING_RESULT } from "@/features/day/model";

/**
 * Shift handover: the SBAR rules live in @sona-ai/domain/handover (the server builds the same cards
 * from its rows). Today's two visits come from their encounters; three ward patients are authored
 * fixtures so the stack reads like a real list.
 */
export type { HandoverCard } from "@sona-ai/domain/handover";

const WARD: HandoverCard[] = [
  { id: "ward-12", name: "Siti Aminah", meta: "Bed 12 · 68 · Female", priority: "watch", situation: "Day 2 of IV antibiotics for community-acquired pneumonia.", background: "Type 2 diabetes. Penicillin tolerated.", assessment: "Afebrile since 06:00; oxygen weaned to 2 L.", recommendation: ["Recheck glucose at 22:00", "Review oral switch on the morning round"], sources: [] },
  { id: "ward-14", name: "Lim Wei Jie", meta: "Bed 14 · 34 · Male", priority: "stable", situation: "Post-op day 1, laparoscopic appendicectomy.", background: "No significant history.", assessment: "Pain controlled; tolerating fluids.", recommendation: ["Encourage mobilising", "Discharge if eating by morning"], sources: [] },
  { id: "ward-09", name: "Ravi Kumar", meta: "Bed 9 · 71 · Male", priority: "watch", situation: "Admitted with heart failure exacerbation.", background: "Chronic kidney disease stage 3.", assessment: "Weight down 1.2 kg on furosemide.", recommendation: ["Repeat renal function at 06:00", "Escalate if urine output < 30 mL/h"], sources: [] },
];

export function buildHandover(patients: Patient[], encounters: Record<string, Encounter | undefined>): HandoverCard[] {
  return build(patients, encounters, [PENDING_RESULT], WARD);
}
