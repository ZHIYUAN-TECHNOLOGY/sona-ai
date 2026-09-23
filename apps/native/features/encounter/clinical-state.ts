import type { Encounter, Patient, PrescriptionCheck, Regimen } from "./types";

export const simulatedRegimen: Regimen = {
  medication: "Paracetamol", formulation: "500 mg tablet", dose: "500", unit: "mg (1 tablet)", route: "Oral",
  frequency: "Every 6 hours as needed for fever · maximum 4 tablets (2 g) per day",
  duration: "Up to 3 days", indication: "Symptomatic relief of fever · synthetic intake and observations",
  sourceId: "paracetamol-reference", sourceVersion: "NHS reviewed 24 Mar 2026 · fixture protocol v2",
};
export function effectivePatient(patient: Patient, encounter?: Encounter): Patient {
  if (!encounter) return patient;
  let next = { ...patient, sources: [...patient.sources] };
  for (const fact of encounter.historyFacts ?? []) {
    if (fact.category === "medical") next.history = [fact.value];
    if (fact.category === "family") next.family = fact.value;
    if (fact.category === "social") next.social = fact.value;
    if (fact.category === "allergy") next.allergies = fact.value;
    if (fact.category === "presenting") next.complaint = fact.value;
    next.sources.push({ id: fact.id, title: `${fact.category} history · revision ${fact.revision}`, kind: "record", date: fact.date, synthetic: true, excerpt: `${fact.value}\nSource: ${fact.source}. Clinician-entered correction to the synthetic record.` });
  }
  if (encounter.medicationEntries) next.medicines = encounter.medicationEntries.map(m => `${m.name}${m.ingredient ? ` · ${m.ingredient}` : " · ingredient unknown"}${m.formulation ? ` · ${m.formulation}` : ""}${m.confirmed ? " · confirmed in simulation" : " · unconfirmed"}`);
  if (encounter.note) next.sources.push({ id: "clinical-note", title: "Clinician note · local session", kind: "record", date: `Encounter revision ${encounter.revision}`, synthetic: true, excerpt: encounter.note });
  return next;
}
export function defaultMedications(patient: Patient) {
  return patient.medicines.map((name, index) => ({ id: `medicine-${index}`, name, ingredient: patient.incomplete ? "" : index === 0 ? "salbutamol" : "cetirizine", formulation: patient.incomplete ? "" : index === 0 ? "inhaler" : "tablet", confirmed: false }));
}
export function getPrescriptionChecks(encounter: Encounter, patient: Patient): PrescriptionCheck[] {
  const inputs = encounter.prescriptionInputs;
  const medicines = encounter.medicationEntries ?? defaultMedications(patient);
  const weight = Number(inputs?.weightKg);
  const check = (id: string, label: string, passed: boolean, yes: string, no: string): PrescriptionCheck => ({ id, label, status: passed ? "passed" : "blocked", detail: passed ? yes : no });
  const supportedNames = new Set(["salbutamol", "albuterol", "cetirizine"]);
  return [
    check("indication", "Indication & patient context", !patient.incomplete && /fever/i.test(patient.complaint), "Fever is documented in the synthetic intake; this is symptom relief, not treatment of a confirmed respiratory diagnosis.", "This fixture needs a documented fever indication and complete baseline context."),
    check("regimen", "Bounded regimen", (!encounter.proposedMedicine || /^paracetamol$/i.test(encounter.proposedMedicine.trim())) && encounter.prescriptionScenario !== "unsupported", "Authored adult paracetamol fixture within the cited dose limits.", "Only the paracetamol tablet fixture is supported; no substitute regimen was invented."),
    check("identity", "Medication identity", medicines.length > 0 && medicines.every(m => m.confirmed && !!m.ingredient.trim() && !!m.formulation.trim()), "All listed ingredients and formulations explicitly confirmed in the synthetic record.", "Confirm each medication ingredient and formulation; unknown tablets cannot be checked."),
    check("coverage", "Interaction coverage", encounter.prescriptionScenario !== "unknown-coverage" && medicines.every(m => supportedNames.has(m.ingredient.trim().toLowerCase())), "Fixture lookup completed for the two supported reported medicines only. This is simulated coverage, not a clinical interaction clearance.", "One or more combinations are outside the fixture's coverage. No blanket safe result is available."),
    check("review", "Current medication review", encounter.medicationCheckedRevision === encounter.revision, `Review recorded at encounter revision ${encounter.revision}.`, "Rerun medication review after the latest context or regimen edit."),
    check("age-weight", "Adult age & weight", patient.age >= 18 && Number.isFinite(weight) && weight >= 50, `Synthetic adult weight: ${inputs?.weightKg} kg.`, "Record a weight of at least 50 kg for this bounded adult fixture; lower or unknown weights need a different regimen."),
    ...([ ["paracetamolAllergy", "Paracetamol allergy"], ["liverDisease", "Liver history"], ["kidneyDisease", "Kidney history"], ["alcoholRisk", "Alcohol risk"] ] as const).map(([key,label]) => check(key, label, inputs?.[key] === "no", "Explicit negative in synthetic eligibility record.", inputs?.[key] === "yes" ? "Positive risk recorded: this case is outside the supported fixture." : "History not recorded. Unknown is not a negative finding.")),
    check("prerequisite", "Prerequisite service", encounter.prescriptionScenario !== "failed-prerequisite", "Fixture prerequisite response available; no live service called.", "Prerequisite service failed. Retry after restoring the fixture response."),
  ];
}
