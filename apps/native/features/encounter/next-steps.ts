import { defaultMedications, getPrescriptionChecks } from "./clinical-state";
import type { Capability, Encounter, Patient } from "./types";

/**
 * The ordered steps between a medication answer and a simulated prescription, derived from the
 * same checks the prescribing panel runs, so the "Next step" bar can never disagree with them.
 * Each step names one action the app knows how to perform.
 */
export type StepAction = { label: string } & ({ type: "confirm"; entryId: string } | { type: "request"; kind: Capability } | { type: "inputs" } | { type: "receipt" });
export type Step = { id: string; label: string; detail: string; done: boolean; action: StepAction };

const ELIGIBILITY = new Set(["age-weight", "paracetamolAllergy", "liverDisease", "kidneyDisease", "alcoholRisk"]);

export function nextSteps(kind: Capability, encounter: Encounter | undefined, patient: Patient): Step[] | undefined {
  // ponytail: medication → prescribing only; other answers already end in one suggested action.
  if (!encounter || patient.incomplete || (kind !== "medication" && kind !== "prescription")) return undefined;
  const entries = encounter.medicationEntries ?? defaultMedications(patient);
  const checks = getPrescriptionChecks(encounter, patient);
  const created = encounter.prescription?.status === "created" && encounter.prescription.revision === encounter.revision;
  return [
    ...entries.map(entry => ({
      id: `confirm-${entry.id}`, label: `Confirm ${entry.name.split(",")[0]}`, detail: [entry.ingredient, entry.formulation].filter(Boolean).join(" · ") || "Identity unknown",
      done: entry.confirmed, action: { label: "Confirm", type: "confirm", entryId: entry.id } as StepAction,
    })),
    { id: "eligibility", label: "Record eligibility", detail: "Weight, allergy, liver, kidney and alcohol history", done: checks.filter(check => ELIGIBILITY.has(check.id)).every(check => check.status === "passed"), action: { label: "Record", type: "inputs" } },
    { id: "review", label: "Run medication review", detail: "Checks interactions for this revision", done: encounter.medicationCheckedRevision === encounter.revision, action: { label: "Run", type: "request", kind: "medication" } },
    { id: "simulate", label: "Run prescribing simulation", detail: "Creates a receipt only if every check passes", done: created, action: created ? { label: "View", type: "receipt" } : { label: "Run", type: "request", kind: "prescription" } },
  ];
}
