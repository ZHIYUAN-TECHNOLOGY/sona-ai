import type { Patient } from "./types";

/**
 * Shift handover in SBAR form (situation, background, assessment, recommendation), one card per
 * patient. The app builds it from its encounters; the server builds it from its rows. Every card
 * keeps its sources and its open items.
 *
 * ponytail: a model drafts the prose later, while the open-item lines stay derived from state so
 * nothing pending can be summarised away.
 */
export type HandoverCard = {
  id: string; patientId?: string; name: string; meta: string; priority: "watch" | "stable";
  situation: string; background: string; assessment: string; recommendation: string[]; sources: string[];
};
export type HandoverPatient = Pick<Patient, "id" | "name" | "age" | "sex" | "time" | "complaint" | "history" | "allergies" | "medicines" | "vitals" | "sources" | "incomplete">;
export type HandoverEncounter = { medicationEntries?: { confirmed: boolean }[]; tasks?: { title: string; due?: string; completed: boolean }[]; noteReviewed?: boolean };
/** An abnormal result nobody has acted on yet. */
export type PendingResult = { patientId: string; test: string; value: string; flag: string; receivedAt: string };

export function buildHandover(patients: HandoverPatient[], encounters: Record<string, HandoverEncounter | undefined>, pending: PendingResult[] = [], extra: HandoverCard[] = []): HandoverCard[] {
  const visits = patients.map((patient): HandoverCard => {
    const encounter = encounters[patient.id];
    const results = pending.filter(r => r.patientId === patient.id);
    const open = results.map(r => `Act on ${r.flag.toLowerCase()} ${r.test.toLowerCase()} (${r.value}), received ${r.receivedAt}`);
    const unconfirmed = (encounter?.medicationEntries ?? patient.medicines.map(() => ({ confirmed: false }))).filter(entry => !entry.confirmed).length;
    if (!patient.incomplete && unconfirmed) open.push(`Confirm ${unconfirmed} reported ${unconfirmed === 1 ? "medicine" : "medicines"} before prescribing`);
    if (patient.incomplete) open.push("Complete onset, observations, allergies and medicines");
    for (const task of encounter?.tasks?.filter(t => !t.completed) ?? []) open.push(`${task.title}${task.due ? ` · due ${task.due}` : ""}`);
    if (!encounter?.noteReviewed) open.push("Review and sign the consultation note");
    const vitals = patient.vitals.map(v => `${v.label} ${v.value}`).join(", ");
    return {
      id: `visit-${patient.id}`, patientId: patient.id, name: patient.name, meta: `Clinic ${patient.time} · ${patient.age} · ${patient.sex}`,
      priority: open.length > 2 || results.length ? "watch" : "stable",
      situation: patient.complaint, background: [patient.history[0], patient.allergies ? `Allergy: ${patient.allergies.split(" — ")[0]}` : "Allergies unknown"].filter(Boolean).join(". ") + ".",
      assessment: vitals ? `Observations: ${vitals}.` : "No observations recorded yet.", recommendation: open,
      sources: patient.sources.filter(s => ["history", "vitals", "consultation"].includes(s.id)).map(s => s.id),
    };
  });
  // Patients to watch lead, so the receiving clinician hears the riskiest first.
  return [...visits, ...extra].sort((a, b) => (a.priority === b.priority ? 0 : a.priority === "watch" ? -1 : 1));
}
