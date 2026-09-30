import { buildHandover as build, type HandoverCard, type HandoverEncounter } from "@sona-ai/domain/handover";
import { findingLine } from "@sona-ai/domain/findings";
import type { Encounter, Patient } from "@/features/encounter/types";
import { PENDING_RESULT } from "@/features/day/model";
import type { Finding } from "@/features/findings/model";

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

/** Open and tracked findings are handed over as one line each, standing in for their own tasks (as the server does). */
export function buildHandover(patients: Patient[], encounters: Record<string, Encounter | undefined>, findings: Finding[] = []): HandoverCard[] {
  const withFindings: Record<string, HandoverEncounter | undefined> = Object.fromEntries(patients.map(p => {
    const mine = findings.filter(f => f.patientId === p.id && f.status !== "dismissed");
    const encounter = encounters[p.id];
    if (!mine.length) return [p.id, encounter];
    const own = new Set(mine.map(f => f.taskId));
    return [p.id, { ...encounter, tasks: [...(encounter?.tasks ?? []).filter(t => !own.has(t.id)), ...mine.map(f => ({ title: findingLine(f), completed: false }))] }];
  }));
  return build(patients, withFindings, [PENDING_RESULT], WARD);
}

/**
 * The deck's outcome: only patients handed over are accepted; "Discuss" ones stay with the outgoing
 * clinician to talk through. `line` heads the summary, `receipt` stamps the acceptance.
 */
export function handoverTally(done: { id: string; decision: "handed" | "discuss" }[]) {
  const handed = done.filter(d => d.decision === "handed").map(d => d.id), discuss = done.filter(d => d.decision === "discuss").map(d => d.id);
  const patients = (n: number) => `${n} ${n === 1 ? "patient" : "patients"}`;
  return {
    handed, discuss,
    line: `${handed.length} handed over${discuss.length ? ` · ${discuss.length} to discuss` : ""}`,
    receipt: (receiver: string, at: string) => `${receiver} accepted ${patients(handed.length)} at ${at}.${discuss.length ? ` ${patients(discuss.length)} to discuss verbally.` : ""}`,
  };
}
