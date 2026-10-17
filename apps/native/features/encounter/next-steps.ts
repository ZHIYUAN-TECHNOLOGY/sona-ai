import { defaultMedications, getPrescriptionChecks, parseRegimen } from "./clinical-state";
import type { Capability, Encounter, Patient, PrescriptionCheck } from "./types";

/**
 * The steps between a medication answer and a recorded prescription: one per check the prescribe
 * card runs, in the card's order (a recorded risk first, the review last), then prescribing itself.
 * So the bar's count is the card's "Resolve N", and its last action is the card's own Prescribe,
 * locked for a role that can't prescribe.
 */
export type StepAction = { label: string } & ({ type: "confirm"; entryId: string } | { type: "run"; kind: "medication" | "prescription" } | { type: "card" } | { type: "receipt" });
/** `stop`: a recorded risk puts the case outside what the dose rules cover. `locked`: this role can't take the step. */
export type Step = { id: string; label: string; detail: string; done: boolean; action: StepAction; stop?: boolean; locked?: boolean };

const RISKS = ["paracetamolAllergy", "liverDisease", "kidneyDisease", "alcoholRisk"] as const;
const ELIGIBILITY = new Set<string>(["age-weight", ...RISKS]);
const risk = (check: PrescriptionCheck, encounter: Encounter) => RISKS.some(key => key === check.id && encounter.prescriptionInputs?.[key] === "yes");
/** A "Yes" to a risk: nothing resolves it but a corrected record, so the card and bar say so instead of "Resolve N". */
export const outsideCase = (encounter: Encounter) => RISKS.some(key => encounter.prescriptionInputs?.[key] === "yes");
/** What prescribing does, said next to the button that does it. */
export const CONSEQUENCE = "Records this prescription on the visit. Nothing is sent to a pharmacy. It can't be edited afterwards, only amended.";

/** What the receipt says happened, by where it was written: the server's visit record, or (sample mode) this phone only. Neither goes to a pharmacy. */
export const receiptWords = (live: boolean) => live
  ? { title: "Prescription recorded", where: "in the visit record, not sent to a pharmacy" }
  : { title: "Sample prescription", where: "on this phone only: no hospital record, no pharmacy" };

/** What the live prescribe card shows, for its lead: a receipt or failure at this revision, a stopped case, ready, or still blocked (undefined). */
export function prescribingState(encounter: Encounter, patient: Patient): "created" | "failed" | "outside" | "ready" | undefined {
  const rx = encounter.prescription?.revision === encounter.revision ? encounter.prescription : undefined;
  if (rx?.status === "created" || rx?.status === "failed") return rx.status;
  if (outsideCase(encounter)) return "outside";
  return getPrescriptionChecks(encounter, patient).every(check => check.status !== "blocked") ? "ready" : undefined;
}

export function nextSteps(kind: Capability, encounter: Encounter | undefined, patient: Patient, canPrescribe = true): Step[] | undefined {
  // ponytail: medication → prescribing only; other answers already end in one suggested action.
  if (!encounter || (kind !== "medication" && kind !== "prescription")) return undefined;
  const unconfirmed = (encounter.medicationEntries ?? defaultMedications(patient)).find(entry => !entry.confirmed);
  const created = encounter.prescription?.status === "created" && encounter.prescription.revision === encounter.revision;
  // The last step names the medicine the clinician entered; before one is entered it names none.
  const medicine = (created ? encounter.prescription?.regimen : parseRegimen(encounter.proposedMedicine))?.medication.toLowerCase();
  const order = (check: PrescriptionCheck) => risk(check, encounter) ? -1 : check.id === "review" ? 1 : 0;
  const action = (check: PrescriptionCheck): StepAction => risk(check, encounter) ? { label: "Review", type: "card" }
    : check.id === "identity" && unconfirmed ? { label: "Confirm", type: "confirm", entryId: unconfirmed.id }
    : check.id === "review" ? { label: "Run", type: "run", kind: "medication" }
    : { label: ELIGIBILITY.has(check.id) ? "Record" : "Review", type: "card" };
  return [
    ...getPrescriptionChecks(encounter, patient).sort((a, b) => order(a) - order(b)).map(check => ({
      id: check.id, label: risk(check, encounter) ? `${check.label} · risk recorded` : check.label, detail: check.detail,
      done: check.status !== "blocked", action: action(check), ...(risk(check, encounter) && { stop: true }),
    })),
    { id: "simulate", label: created ? "Prescription recorded" : medicine ? `Prescribe ${medicine}` : "Prescribe", detail: CONSEQUENCE, done: created,
      action: created ? { label: "View", type: "receipt" } : { label: "Prescribe", type: "run", kind: "prescription" }, ...(!created && !canPrescribe && { locked: true }) },
  ];
}
