import { defaultMedications } from "@/features/encounter/clinical-state";
import type { Encounter, Patient } from "@/features/encounter/types";
import { PENDING_RESULT } from "@/features/day/model";

/**
 * Shift handover in SBAR form (situation, background, assessment, recommendation), one card per
 * patient. Today's two visits are built from their encounter; three ward patients are authored
 * fixtures so the stack reads like a real list. Every card keeps its sources and its open items.
 *
 * ponytail: composed from fixtures and encounter state; a model drafts the prose later, while the
 * open-item lines stay derived from state so nothing pending can be summarised away.
 */
export type HandoverCard = {
  id: string; patientId?: string; name: string; meta: string; priority: "watch" | "stable";
  situation: string; background: string; assessment: string; recommendation: string[]; sources: string[];
};

const WARD: HandoverCard[] = [
  { id: "ward-12", name: "Siti Aminah", meta: "Bed 12 · 68 · Female", priority: "watch", situation: "Day 2 of IV antibiotics for community-acquired pneumonia.", background: "Type 2 diabetes. Penicillin tolerated.", assessment: "Afebrile since 06:00; oxygen weaned to 2 L.", recommendation: ["Recheck glucose at 22:00", "Review oral switch on the morning round"], sources: [] },
  { id: "ward-14", name: "Lim Wei Jie", meta: "Bed 14 · 34 · Male", priority: "stable", situation: "Post-op day 1, laparoscopic appendicectomy.", background: "No significant history.", assessment: "Pain controlled; tolerating fluids.", recommendation: ["Encourage mobilising", "Discharge if eating by morning"], sources: [] },
  { id: "ward-09", name: "Ravi Kumar", meta: "Bed 9 · 71 · Male", priority: "watch", situation: "Admitted with heart failure exacerbation.", background: "Chronic kidney disease stage 3.", assessment: "Weight down 1.2 kg on furosemide.", recommendation: ["Repeat renal function at 06:00", "Escalate if urine output < 30 mL/h"], sources: [] },
];

export function buildHandover(patients: Patient[], encounters: Record<string, Encounter | undefined>): HandoverCard[] {
  const visits = patients.map((patient): HandoverCard => {
    const encounter = encounters[patient.id];
    const open: string[] = [];
    if (PENDING_RESULT.patientId === patient.id) open.push(`Act on ${PENDING_RESULT.flag.toLowerCase()} ${PENDING_RESULT.test.toLowerCase()} (${PENDING_RESULT.value}), received ${PENDING_RESULT.receivedAt}`);
    const unconfirmed = (encounter?.medicationEntries ?? defaultMedications(patient)).filter(entry => !entry.confirmed).length;
    if (!patient.incomplete && unconfirmed) open.push(`Confirm ${unconfirmed} reported ${unconfirmed === 1 ? "medicine" : "medicines"} before prescribing`);
    if (patient.incomplete) open.push("Complete onset, observations, allergies and medicines");
    for (const task of encounter?.tasks.filter(t => !t.completed) ?? []) open.push(`${task.title}${task.due ? ` · due ${task.due}` : ""}`);
    if (!encounter?.noteReviewed) open.push("Review and sign the consultation note");
    const vitals = patient.vitals.map(v => `${v.label} ${v.value}`).join(", ");
    return {
      id: `visit-${patient.id}`, patientId: patient.id, name: patient.name, meta: `Clinic ${patient.time} · ${patient.age} · ${patient.sex}`,
      priority: open.length > 2 || PENDING_RESULT.patientId === patient.id ? "watch" : "stable",
      situation: patient.complaint, background: [patient.history[0], patient.allergies ? `Allergy: ${patient.allergies.split(" — ")[0]}` : "Allergies unknown"].filter(Boolean).join(". ") + ".",
      assessment: vitals ? `Observations: ${vitals}.` : "No observations recorded yet.", recommendation: open,
      sources: patient.sources.filter(s => ["history", "vitals", "consultation"].includes(s.id)).map(s => s.id),
    };
  });
  // Patients to watch lead, so the receiving clinician hears the riskiest first.
  return [...visits, ...WARD].sort((a, b) => (a.priority === b.priority ? 0 : a.priority === "watch" ? -1 : 1));
}
