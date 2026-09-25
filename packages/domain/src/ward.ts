import { EMPTY_DISCHARGE } from "./discharge";
import type { Encounter, Patient } from "./types";

/**
 * The ward at a glance for the charge nurse or bed manager: every bed, who is fit to go, what is
 * holding each discharge, and who owns each blocker. Bed 6 is the demo patient and reads the live
 * discharge and guarantee-letter state, so resolving it in flows 1 and 2 clears it here.
 *
 * ponytail: authored ward fixtures; bed data and predicted discharge times come from the bed
 * system later. Owners are the four teams that clear most discharge blockers.
 */
export type Owner = "Pharmacy" | "Billing" | "Porter" | "Nurse";
export type BlockerKind = "gl" | "pharmacy" | "transport" | "result" | "booking";
export type WardBlocker = { id: string; kind: BlockerKind; label: string; detail: string };
export type Bed = {
  bed: string; patientId?: string; name?: string; initials?: string; meta?: string;
  status: "fit" | "watch" | "stable" | "empty" | "free"; predicted: string; waitingHours?: number;
  sbar?: { s: string; b: string; a: string; r: string }; blockers: WardBlocker[];
};

export const OWNERS: Owner[] = ["Pharmacy", "Billing", "Porter", "Nurse"];
export const SUGGESTED: Record<BlockerKind, Owner> = { gl: "Billing", pharmacy: "Pharmacy", transport: "Porter", result: "Nurse", booking: "Nurse" };
export const DEMO_PATIENT = "SYN-1042";

const FIXED: Bed[] = [
  { bed: "Bed 2", name: "Nurul Huda", initials: "NH", meta: "29 · Female", status: "fit", predicted: "11:00", waitingHours: 5,
    sbar: { s: "Day 3 of antibiotics for pyelonephritis.", b: "No significant history.", a: "Afebrile 36 h, eating and walking.", r: "Discharge once the final GL and sensitivities are in." },
    blockers: [{ id: "b2-gl", kind: "gl", label: "Final guarantee letter", detail: "Synthetic TPA · requested 08:10" }, { id: "b2-result", kind: "result", label: "Urine culture sensitivities", detail: "Lab expects by 12:00" }] },
  { bed: "Bed 14", name: "Lim Wei Jie", initials: "LW", meta: "34 · Male", status: "fit", predicted: "14:30", waitingHours: 3,
    sbar: { s: "Post-op day 1, laparoscopic appendicectomy.", b: "No significant history.", a: "Pain controlled, eating, mobilising.", r: "Discharge today once take-home analgesia and a ride are sorted." },
    blockers: [{ id: "b14-pharm", kind: "pharmacy", label: "Take-home analgesia", detail: "Not yet dispensed" }, { id: "b14-ride", kind: "transport", label: "Ride home", detail: "Family free after 17:00" }] },
  { bed: "Bed 8", name: "Priya Nair", initials: "PN", meta: "45 · Female", status: "fit", predicted: "13:00", waitingHours: 1,
    sbar: { s: "Day 4, cellulitis of the left leg.", b: "Type 2 diabetes.", a: "Redness receding, afebrile.", r: "Discharge on oral antibiotics; wound clinic in a week." }, blockers: [] },
  { bed: "Bed 12", name: "Siti Aminah", initials: "SA", meta: "68 · Female", status: "watch", predicted: "Tomorrow",
    sbar: { s: "Day 2 of IV antibiotics for pneumonia.", b: "Type 2 diabetes.", a: "Afebrile since 06:00, oxygen weaned to 2 L.", r: "Review oral switch on the morning round." }, blockers: [] },
  { bed: "Bed 9", name: "Ravi Kumar", initials: "RK", meta: "71 · Male", status: "watch", predicted: "In 2 days",
    sbar: { s: "Heart failure exacerbation.", b: "Chronic kidney disease stage 3.", a: "Weight down 1.2 kg on furosemide.", r: "Repeat renal function at 06:00." },
    blockers: [{ id: "b9-renal", kind: "result", label: "Renal function", detail: "Due 06:00" }] },
  { bed: "Bed 4", name: "Tan Ah Kow", initials: "TK", meta: "76 · Male", status: "stable", predicted: "Awaiting rehab",
    sbar: { s: "Stroke, day 9, medically stable.", b: "Hypertension, atrial fibrillation.", a: "Needs inpatient rehabilitation.", r: "Transfer when a rehab bed opens." },
    blockers: [{ id: "b4-transfer", kind: "transport", label: "Transfer to rehab centre", detail: "Waiting for a bed" }] },
  { bed: "Bed 10", status: "empty", predicted: "Cleaning · ready 12:30", blockers: [] },
];

/** The demo patient's bed, built from the live discharge and guarantee-letter state. */
function demoBed(patient: Patient | undefined, encounter: Encounter | undefined): Bed {
  const d = encounter?.discharge ?? EMPTY_DISCHARGE;
  if (d.dischargedAt) return { bed: "Bed 6", status: "free", predicted: "Free · cleaning next", blockers: [] };
  const blockers: WardBlocker[] = [];
  if (!d.glReceived) blockers.push({ id: "b6-gl", kind: "gl", label: "Final guarantee letter", detail: encounter?.claim?.status === "sent" ? "Sent · awaiting insurer" : "Codes ready to review" });
  if (!d.medsConfirmed) blockers.push({ id: "b6-meds", kind: "pharmacy", label: "Take-home medicines", detail: "1 changed · 1 new · 1 stopped" });
  if (!d.followUp) blockers.push({ id: "b6-followup", kind: "booking", label: "Follow-up booking", detail: "Clinic review, about 2 weeks" });
  return {
    bed: "Bed 6", patientId: DEMO_PATIENT, name: patient?.name ?? "Amelia Tan", initials: patient?.initials ?? "AT", meta: patient ? `${patient.age} · ${patient.sex}` : undefined,
    status: "fit", predicted: blockers.length ? "Once cleared" : "Now", waitingHours: 1,
    sbar: { s: "Community-acquired pneumonia, mild, day 2.", b: "Asthma. Penicillin allergy reported.", a: "Afebrile 18 h, SpO₂ 97% on room air.", r: "Discharge today on oral azithromycin." }, blockers,
  };
}

/** One admission's rows, flattened: the server's view of what holds a bed. No `gl` means self-pay. */
export type BedRows = {
  admissionId: string; gl?: { status: "requested" | "received"; claimStatus?: "draft" | "sent" | "approved" };
  medsConfirmed: boolean; followUpBooked: boolean; pendingResults: { id: string; test: string; expected?: string }[];
};

/** A bed's blockers derived from rows (the server version of demoBed); ids are stable so owners stick. */
export function bedBlockers(rows: BedRows): WardBlocker[] {
  const id = rows.admissionId, blockers: WardBlocker[] = [];
  if (rows.gl?.status === "requested") blockers.push({ id: `${id}-gl`, kind: "gl", label: "Final guarantee letter", detail: rows.gl.claimStatus === "sent" ? "Sent · awaiting insurer" : "Codes ready to review" });
  if (!rows.medsConfirmed) blockers.push({ id: `${id}-meds`, kind: "pharmacy", label: "Take-home medicines", detail: "Not yet confirmed" });
  if (!rows.followUpBooked) blockers.push({ id: `${id}-followup`, kind: "booking", label: "Follow-up booking", detail: "Clinic review not booked" });
  for (const r of rows.pendingResults) blockers.push({ id: `${id}-result-${r.id}`, kind: "result", label: r.test, detail: r.expected ? `Expected by ${r.expected}` : "Pending" });
  return blockers;
}

export function wardBeds(patients: Patient[], encounters: Record<string, Encounter | undefined>): Bed[] {
  const demo = demoBed(patients.find(p => p.id === DEMO_PATIENT), encounters[DEMO_PATIENT]);
  // Fit-to-go beds lead, the most blocked first, so the eye lands on what to unblock.
  const rank = (b: Bed) => (b.status === "fit" ? 0 : b.status === "watch" ? 1 : b.status === "stable" ? 2 : 3) * 10 - b.blockers.length;
  return [demo, ...FIXED].sort((a, b) => rank(a) - rank(b));
}

export function wardSummary(beds: Bed[]) {
  const occupied = beds.filter(b => b.name);
  const fit = occupied.filter(b => b.status === "fit");
  const blocked = fit.filter(b => b.blockers.length);
  return { beds: beds.length, fit: fit.length, blocked: blocked.length, bedHours: blocked.reduce((sum, b) => sum + (b.waitingHours ?? 0), 0) };
}

/** Three lines for the huddle: what blocks the most beds, and who owns it. */
export function huddle(beds: Bed[], owners: Record<string, Owner | undefined>): string[] {
  const s = wardSummary(beds);
  const blockedBeds = beds.filter(b => b.status === "fit" && b.blockers.length);
  const unowned = blockedBeds.flatMap(b => b.blockers).filter(x => !owners[x.id]).length;
  const top = blockedBeds[0];
  return [
    `${s.fit} fit to go, ${s.blocked} still blocked, about ${s.bedHours} bed-hours waiting.`,
    top ? `Start with ${top.bed}: ${top.blockers.map(x => x.label.toLowerCase()).join(", ")}.` : "No discharge is blocked right now.",
    unowned ? `${unowned} ${unowned === 1 ? "blocker has" : "blockers have"} no owner yet.` : "Every blocker has an owner.",
  ];
}
