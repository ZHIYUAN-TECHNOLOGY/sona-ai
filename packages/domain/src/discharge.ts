import { followUpLine } from "./findings";
import type { Encounter, Patient, PrescriptionCheck, Task } from "./types";

/**
 * Discharge in one card: a drafted summary, the few things that still block the patient from
 * leaving (final guarantee letter, take-home medicines, follow-up), a patient leaflet, and a
 * receipt that says how much earlier the bed is free.
 *
 * ponytail: authored fixtures for the demo patient. A model drafts the summary, reconciliation and
 * leaflet later; the blockers stay derived from state so nothing pending can be drafted away.
 */
export type Language = "ms" | "en" | "zh";
export type FollowUp = "1w" | "2w" | "4w";
export type DischargeState = { glReceived: boolean; medsConfirmed: boolean; followUp?: FollowUp; language: Language; dischargedAt?: string; savedMinutes?: number };
export type MedChange = { name: string; change: "changed" | "new" | "stopped" | "unchanged"; detail: string };
export type DischargePlan = {
  bed: string; fitMinutesAgo: number; insurer: string; glRequestedAt: string;
  summary: { diagnosis: string; course: string; plan: string }; full: string;
  meds: MedChange[]; leaflet: Record<Language, string>;
};

export const LANGUAGES: { id: Language; label: string; name: string }[] = [
  { id: "ms", label: "BM", name: "Bahasa Melayu" }, { id: "en", label: "EN", name: "English" }, { id: "zh", label: "中文", name: "Chinese" },
];
export const FOLLOW_UPS: { id: FollowUp; label: string; days: number }[] = [
  { id: "1w", label: "1 wk", days: 7 }, { id: "2w", label: "2 wk", days: 14 }, { id: "4w", label: "4 wk", days: 28 },
];
export const EMPTY_DISCHARGE: DischargeState = { glReceived: false, medsConfirmed: false, language: "ms" };

// ponytail: one authored plan (the respiratory demo patient); other complete patients reuse it with their name.
const PLAN: DischargePlan = {
  bed: "Bed 6", fitMinutesAgo: 25, insurer: "Synthetic insurer", glRequestedAt: "09:40",
  summary: {
    diagnosis: "Community-acquired pneumonia, mild (CURB-65 0), on background asthma.",
    course: "36 h observation. Afebrile 18 h, SpO₂ 97% on room air, eating and walking.",
    plan: "Oral azithromycin 2 more days, inhaler as needed, clinic review.",
  },
  full: "Admitted with five days of cough and one day of fever. Chest film showed right lower zone consolidation. Treated with IV then oral azithromycin (penicillin allergy reported) and 4-hourly nebulised salbutamol, weaned to her own inhaler. Observations normal for 18 hours; no oxygen requirement. Safety-netting explained in her preferred language. Synthetic record, not a real patient.",
  meds: [
    { name: "Azithromycin", change: "changed", detail: "IV 500 mg to oral 500 mg daily, 2 more days" },
    { name: "Paracetamol", change: "new", detail: "1 g every 6 h as needed, max 4 g a day" },
    { name: "Nebulised salbutamol", change: "stopped", detail: "Back to her own inhaler as needed" },
    { name: "Cetirizine", change: "unchanged", detail: "Patient-reported, continue" },
  ],
  leaflet: {
    ms: "Anda dirawat kerana jangkitan paru-paru. Makan azithromycin sekali sehari selama 2 hari lagi. Datang semula segera jika sukar bernafas, bibir menjadi biru, atau demam kembali.",
    en: "You were treated for a chest infection. Take azithromycin once a day for 2 more days. Come back straight away if breathing gets harder, your lips turn blue, or the fever returns.",
    zh: "您因肺部感染接受了治疗。请每天服用一次阿奇霉素，再服两天。如呼吸更困难、嘴唇发紫或再次发烧，请立即回院。",
  },
};

export const canDischarge = (patient: Patient) => !patient.incomplete;
export const planFor = (_patient: Patient): DischargePlan => PLAN;

/** An incidental finding nobody has tracked or dismissed yet (demo flow 6); it travels with the patient. */
export type OpenFinding = { id: string; label: string; action: string | null; dueAt?: Date | string | null };

/** What still stands between the patient and the door, in the prescribe card's check shape. */
export function dischargeChecks(state: DischargeState, plan: DischargePlan, findings: OpenFinding[] = []): PrescriptionCheck[] {
  const changes = plan.meds.filter(m => m.change !== "unchanged");
  const count = (c: MedChange["change"]) => changes.filter(m => m.change === c).length;
  return [
    { id: "observations", label: "Observations stable", status: "passed", detail: "Normal for 18 h" },
    { id: "summary", label: "Discharge summary drafted", status: "passed", detail: "From the visit record" },
    { id: "gl", label: "Final guarantee letter", status: state.glReceived ? "passed" : "blocked", detail: `${plan.insurer} · requested ${plan.glRequestedAt}` },
    { id: "meds", label: "Take-home medicines", status: state.medsConfirmed ? "passed" : "blocked", detail: [count("changed") && `${count("changed")} changed`, count("new") && `${count("new")} new`, count("stopped") && `${count("stopped")} stopped`].filter(Boolean).join(" · ") },
    { id: "followup", label: "Follow-up booked", status: state.followUp ? "passed" : "blocked", detail: "Clinic review · 2 weeks is usual after pneumonia" },
    ...findings.map(f => ({ id: `finding-${f.id}`, label: f.label, status: "blocked" as const, detail: followUpLine(f) })),
  ];
}

// ponytail: a fixed ward benchmark for the wait from "fit for discharge" to leaving; real bed data replaces it.
export const TYPICAL_WAIT_MINUTES = 275;
/** Minutes the bed frees ahead of the ward's typical fit-to-door wait (0 when slower). */
export function minutesSaved(fitAt: Date, at: Date): number {
  return Math.max(0, TYPICAL_WAIT_MINUTES - Math.round((at.getTime() - fitAt.getTime()) / 60000));
}
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? `${h} h ${m} m` : `${m} m`;
}

/** The follow-up tasks a discharge leaves behind, so they travel into Tasks and handover. */
export function dischargeTasks(patient: Patient, state: DischargeState, plan: DischargePlan, at: Date): Task[] {
  const days = FOLLOW_UPS.find(f => f.id === state.followUp)?.days ?? 14;
  const due = new Date(at.getTime() + days * 86400000).toLocaleDateString([], { day: "numeric", month: "short" });
  return [
    { id: `discharge-review-${patient.id}`, title: `Book clinic review for ${patient.name.split(" ")[0]}`, owner: "Clinic clerk", due, completed: false, provenance: "clinician" },
    { id: `discharge-claim-${patient.id}`, title: `Submit final claim to ${plan.insurer.toLowerCase()}`, owner: "Billing", due: "Today", completed: false, provenance: "clinician" },
  ];
}

/** An approved consequential action; structurally the `ApprovedCommand` contract in @sona-ai/api. */
export type Approval = { encounterId: string; requestId: string; approvedBy: string };
export type Refusal = { status: "refused"; reason: "unapproved" | "blocked"; open: string[] };
export type DischargeReceipt = { status: "discharged"; encounterId: string; requestId: string; approvedBy: string; dischargedAt: string; savedMinutes: number };

/** Labels of the checks still blocked; empty when nothing stands in the way. */
export const openLabels = (checks: PrescriptionCheck[]) => checks.filter(c => c.status === "blocked").map(c => c.label);

/** Server rule: no discharge without a named approver or while any blocker is open, whatever the app shows. */
export function decideDischarge(state: DischargeState, plan: DischargePlan, command: Approval, fitAt: Date, at: Date, findings: OpenFinding[] = []): Refusal | DischargeReceipt {
  if (!command.approvedBy.trim()) return { status: "refused", reason: "unapproved", open: [] };
  const open = openLabels(dischargeChecks(state, plan, findings));
  if (open.length) return { status: "refused", reason: "blocked", open };
  const { encounterId, requestId, approvedBy } = command;
  return { status: "discharged", encounterId, requestId, approvedBy, dischargedAt: at.toISOString(), savedMinutes: minutesSaved(fitAt, at) };
}

export function discharge(encounter: Encounter, patient: Patient, fitAt: Date, at: Date): Encounter {
  const state = encounter.discharge ?? EMPTY_DISCHARGE;
  const tasks = dischargeTasks(patient, state, planFor(patient), at).filter(t => !encounter.tasks.some(e => e.id === t.id));
  return { ...encounter, discharge: { ...state, dischargedAt: at.toISOString(), savedMinutes: minutesSaved(fitAt, at) }, tasks: [...encounter.tasks, ...tasks] };
}
