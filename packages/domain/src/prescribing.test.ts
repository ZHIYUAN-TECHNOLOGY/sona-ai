import { expect, test } from "bun:test";
import { getPrescriptionChecks } from "./prescribing";
import type { Encounter, Patient } from "./types";

const amelia = { id: "SYN-1042", age: 42, complaint: "Cough for five days, with fever since yesterday.", incomplete: false, medicines: ["Salbutamol inhaler, as needed", "Cetirizine, patient-reported"] } as Patient;
const confirmed = [
  { id: "m0", name: "Salbutamol inhaler", ingredient: "salbutamol", formulation: "inhaler", confirmed: true },
  { id: "m1", name: "Cetirizine", ingredient: "cetirizine", formulation: "tablet", confirmed: true },
];
const eligible = { weightKg: "62", liverDisease: "no", kidneyDisease: "no", alcoholRisk: "no", paracetamolAllergy: "no" } as const;
const blocked = (encounter: Partial<Encounter>, patient = amelia) =>
  getPrescriptionChecks({ revision: 1, ...encounter } as Encounter, patient).filter(c => c.status === "blocked").map(c => c.label);

test("a fresh visit is blocked on identity, review, weight and every unrecorded history item", () => {
  expect(blocked({})).toEqual(["Medication identity", "Current medication review", "Adult age & weight", "Paracetamol allergy", "Liver history", "Kidney history", "Alcohol risk"]);
});

test("confirmed medicines, eligibility and a review at the current revision pass all 11 checks", () => {
  expect(blocked({ medicationEntries: confirmed, prescriptionInputs: eligible, medicationCheckedRevision: 1 })).toEqual([]);
});

test("a review taken at an older revision blocks, and so does a weight under 50 kg or a positive risk", () => {
  expect(blocked({ revision: 2, medicationEntries: confirmed, prescriptionInputs: { ...eligible, weightKg: "48", liverDisease: "yes" }, medicationCheckedRevision: 1 }))
    .toEqual(["Current medication review", "Adult age & weight", "Liver history"]);
});

test("an unknown tablet is outside interaction coverage, and an incomplete intake has no indication", () => {
  const unknown = [{ id: "m0", name: "Tablet", ingredient: "", formulation: "", confirmed: false }];
  const daniel = { ...amelia, incomplete: true, complaint: "Breathlessness on exertion" };
  expect(blocked({ medicationEntries: unknown, prescriptionInputs: eligible, medicationCheckedRevision: 1 }, daniel))
    .toEqual(["Indication & patient context", "Medication identity", "Interaction coverage"]);
});
