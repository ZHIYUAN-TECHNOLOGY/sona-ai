import { expect, test } from "bun:test";
import { defaultMedications, getPrescriptionChecks, parseRegimen, regimenLine, regimenOf } from "./prescribing";
import type { Encounter, Patient } from "./types";

const amelia = { id: "SYN-1042", age: 42, allergies: "Penicillin — reported rash", complaint: "Cough for five days, with fever since yesterday.", incomplete: false, medicines: ["Salbutamol inhaler, as needed", "Cetirizine, patient-reported"] } as Patient;
const confirmed = [
  { id: "m0", name: "Salbutamol inhaler", ingredient: "salbutamol", formulation: "inhaler", confirmed: true },
  { id: "m1", name: "Cetirizine", ingredient: "cetirizine", formulation: "tablet", confirmed: true },
];
const eligible = { weightKg: "62", liverDisease: "no", kidneyDisease: "no", alcoholRisk: "no", paracetamolAllergy: "no" } as const;
const entered = { medication: "Paracetamol", formulation: "500 mg tablet", dose: "1000", unit: "mg", route: "Oral", frequency: "Every 6 hours", duration: "3 days" };
const regimen = regimenLine(entered);
const blocked = (encounter: Partial<Encounter>, patient = amelia) =>
  getPrescriptionChecks({ revision: 1, ...encounter } as Encounter, patient).filter(c => c.status === "blocked").map(c => c.label);

test("a fresh visit is blocked on the regimen nobody has entered, identity, review, weight and every unrecorded history item", () => {
  expect(blocked({})).toEqual(["Bounded regimen", "Medication identity", "Current medication review", "Adult age & weight", "Paracetamol allergy", "Liver history", "Kidney history", "Alcohol risk"]);
});

test("an entered regimen, confirmed medicines, eligibility and a review at the current revision pass all 11 checks", () => {
  expect(blocked({ proposedMedicine: regimen, medicationEntries: confirmed, prescriptionInputs: eligible, medicationCheckedRevision: 1 })).toEqual([]);
});

test("by mouth and PO read as oral, so the web form's own hint passes the dose rule", () => {
  for (const route of ["by mouth", "PO", " oral "]) expect(blocked({ proposedMedicine: regimenLine({ ...entered, route }), medicationEntries: confirmed, prescriptionInputs: eligible, medicationCheckedRevision: 1 })).toEqual([]);
  expect(blocked({ proposedMedicine: regimenLine({ ...entered, route: "IV" }), medicationEntries: confirmed, prescriptionInputs: eligible, medicationCheckedRevision: 1 })).toEqual(["Bounded regimen"]);
});

test("a review taken at an older revision blocks, and so does a weight under 50 kg or a positive risk", () => {
  expect(blocked({ revision: 2, proposedMedicine: regimen, medicationEntries: confirmed, prescriptionInputs: { ...eligible, weightKg: "48", liverDisease: "yes" }, medicationCheckedRevision: 1 }))
    .toEqual(["Current medication review", "Adult age & weight", "Liver history"]);
});

test("an unknown tablet is outside interaction coverage, and an incomplete intake has no indication", () => {
  const unknown = [{ id: "m0", name: "Tablet", ingredient: "", formulation: "", confirmed: false }];
  const daniel = { ...amelia, incomplete: true, complaint: "Breathlessness on exertion" };
  expect(blocked({ proposedMedicine: regimen, medicationEntries: unknown, prescriptionInputs: eligible, medicationCheckedRevision: 1 }, daniel))
    .toEqual(["Indication & patient context", "Medication identity", "Interaction coverage"]);
});

const ready = { medicationEntries: confirmed, prescriptionInputs: eligible, medicationCheckedRevision: 1 };
const verdict = (change: Partial<typeof entered>) => getPrescriptionChecks({ revision: 1, ...ready, proposedMedicine: regimenLine({ ...entered, ...change }) } as Encounter, amelia).find(c => c.id === "regimen")!;

test("the regimen is the one entered: its line reads back whole, and the visit's regimen cites the complaint and the dose source", () => {
  expect(regimen).toBe("Paracetamol 500 mg tablet · 1000 mg · Oral · Every 6 hours · 3 days");
  expect(parseRegimen(regimen)).toEqual(entered);
  expect(regimenOf({ proposedMedicine: regimen }, amelia)).toEqual({ ...entered, indication: `Recorded complaint: ${amelia.complaint}`, sourceId: "paracetamol-reference", sourceVersion: "NHS · Paracetamol for adults · reviewed 24 Mar 2026" });
  // A bare medicine name, or nothing, is no regimen: there is no stock one to fall back on.
  for (const line of [undefined, "", "Paracetamol", "Paracetamol 500 mg tablet · 1000 mg · Oral"]) expect(regimenOf({ proposedMedicine: line }, amelia)).toBeUndefined();
});

test("the dose rule works out the entered regimen's 24-hour total and blocks what is outside the NHS adult limits", () => {
  expect(verdict({})).toMatchObject({ status: "passed", detail: expect.stringContaining("1000 mg every 6 hours for 3 days: at most 4000 mg in 24 hours") });
  expect(verdict({ dose: "500", frequency: "Every 8 hours", duration: "1 day" })).toMatchObject({ status: "passed", detail: expect.stringContaining("at most 1500 mg in 24 hours") });
  for (const outside of [{ dose: "1500" }, { frequency: "Every 4 hours" }, { frequency: "Every 2 hours" }, { frequency: "When needed" }, { duration: "5 days" }, { route: "Intravenous" }, { formulation: "1000 mg tablet" }, { unit: "g" }])
    expect(verdict(outside).status).toBe("blocked");
});

test("an allergy on the record blocks even when the card's answer says no", () => {
  expect(blocked({ ...ready, proposedMedicine: regimen }, { ...amelia, allergies: "Paracetamol — rash in 2024" })).toEqual(["Paracetamol allergy"]);
});

test("reported medicines take their ingredient and form from the record's own words, never from their position in the list", () => {
  expect(defaultMedications({ medicines: ["Cetirizine, patient-reported", "Salbutamol inhaler, as needed", "Patient reports a tablet; ingredient unknown", "Metformin"] } as Patient).map(m => [m.ingredient, m.formulation, m.confirmed]))
    .toEqual([["cetirizine", "", false], ["salbutamol", "inhaler", false], ["", "tablet", false], ["", "", false]]);
});

test("an allergy the record lists blocks whatever the card answered, and is marked as the record's own so the card offers no answer for it", () => {
  const allergic = { ...amelia, allergies: "Paracetamol — rash" } as Patient;
  const check = (patient: Patient) => getPrescriptionChecks({ revision: 1, prescriptionInputs: eligible } as Encounter, patient).find(c => c.id === "paracetamolAllergy")!;
  expect(check(allergic)).toMatchObject({ status: "blocked", recorded: true, detail: "The record lists this allergy: Paracetamol — rash. Paracetamol is not prescribed." });
  expect(check(amelia)).toEqual({ id: "paracetamolAllergy", label: "Paracetamol allergy", status: "passed", detail: "Recorded as no by the clinician." });
});

test("any other medicine is Sona's to check at the review: its verdicts are the checks, and a warning never blocks", () => {
  const ibuprofen = regimenLine({ ...entered, medication: "Ibuprofen", formulation: "400 mg tablet", dose: "400", frequency: "Every 8 hours" });
  const checks = (encounter: Partial<Encounter>) => getPrescriptionChecks({ revision: 1, ...ready, prescriptionInputs: undefined, proposedMedicine: ibuprofen, ...encounter } as Encounter, amelia);
  // Not reviewed yet: Sona has not looked, so the order waits; the paracetamol rules (weight, the four history questions) do not apply.
  expect(checks({ medicationCheckedRevision: undefined }).filter(c => c.status === "blocked").map(c => c.label)).toEqual(["Current medication review", "Sona's check"]);
  // Reviewed, but the model could not answer: one warning to check it by hand, and nothing blocks.
  expect(checks({ sonaCheck: { for: ibuprofen, items: [] } }).map(c => [c.id, c.status])).toEqual([["identity", "passed"], ["review", "passed"], ["sona", "warning"], ["prerequisite", "passed"]]);
  // Its verdicts, each marked as Sona's; an area it skipped is a warning, a block blocks, and a check of another order counts for nothing.
  const sonaCheck = { for: ibuprofen, model: "gemma", items: [
    { id: "dose", label: "dose", status: "passed" as const, detail: "400 mg every 8 hours is within the adult range." },
    { id: "allergy", label: "allergy", status: "passed" as const, detail: "Penicillin allergy does not cross-react with ibuprofen." },
    { id: "interactions", label: "interactions", status: "blocked" as const, detail: "Asthma: NSAIDs can trigger bronchospasm." },
    { id: "pregnancy", label: "Pregnancy", status: "warning" as const, detail: "Pregnancy status is not recorded." },
  ] };
  expect(checks({ sonaCheck }).filter(c => c.by === "sona").map(c => [c.label, c.status])).toEqual([
    ["Dose & frequency", "passed"], ["Allergies", "passed"], ["Interactions with medicines & conditions", "blocked"], ["Kidney function", "warning"], ["Liver function", "warning"], ["Pregnancy", "warning"],
  ]);
  expect(checks({ sonaCheck: { ...sonaCheck, for: regimen } }).find(c => c.id === "sona")?.status).toBe("blocked");
  expect(regimenOf({ proposedMedicine: ibuprofen }, amelia)?.sourceId).toBe("sona-order-check");
});
