import type { Encounter, Patient, PrescriptionCheck, Regimen } from "./types";

/** What the clinician enters for a regimen; the indication and the cited dose source come from the record and the rules (regimenOf). */
export type EnteredRegimen = Pick<Regimen, "medication" | "formulation" | "dose" | "unit" | "route" | "frequency" | "duration">;
/**
 * The entered regimen as the one line the visit record carries: "Paracetamol 500 mg tablet · 1000 mg · Oral · Every 6 hours · 3 days".
 * ponytail: it rides in `proposedMedicine` because the encounter edit carries only that string; a structured
 * `proposedRegimen` on the edit contract replaces the line and its parser.
 */
export const regimenLine = (r: EnteredRegimen) => [`${r.medication} ${r.formulation}`, `${r.dose} ${r.unit}`, r.route, r.frequency, r.duration].map(part => part.trim()).join(" · ");
/** Reads the line back; anything that is not a whole regimen (a bare medicine name, a missing or extra part) is no regimen. */
export function parseRegimen(line?: string): EnteredRegimen | undefined {
  const [product, amount, route, frequency, duration, ...rest] = (line ?? "").split(" · ").map(part => part.trim());
  const [, medication, formulation] = product?.match(/^(\D+?)\s+(\d.*)$/) ?? [];
  const [, dose, unit] = amount?.match(/^(\d+(?:\.\d+)?)\s*(\S.*)$/) ?? [];
  if (!medication || !formulation || !dose || !unit || !route || !frequency || !duration || rest.length) return undefined;
  return { medication, formulation, dose, unit, route, frequency, duration };
}
/** Adult paracetamol tablets as the NHS page states them (the record's `paracetamol-reference` source): the only regimen these rules can check. */
const NHS = { sourceId: "paracetamol-reference", sourceVersion: "NHS · Paracetamol for adults · reviewed 24 Mar 2026" };
const isParacetamol = (medication: string) => /^paracetamol$/i.test(medication.trim());
/** This visit's regimen as the clinician entered it, with the complaint it answers and the source its dose is checked against. */
export function regimenOf(encounter: Pick<Encounter, "proposedMedicine">, patient: Pick<Patient, "complaint">): Regimen | undefined {
  const entered = parseRegimen(encounter.proposedMedicine);
  return entered && { ...entered, indication: `Recorded complaint: ${patient.complaint}`, ...(isParacetamol(entered.medication) ? NHS : { sourceId: "", sourceVersion: "No dose rule covers this medicine" }) };
}
/** The dose rule: whether the entered regimen is inside the NHS adult limits, with the sum that shows it (or what puts it outside). */
function doseVerdict(r: EnteredRegimen | undefined): [boolean, string] {
  if (!r) return [false, "No regimen entered. Enter the medicine, strength, dose, route, frequency and duration."];
  if (!isParacetamol(r.medication)) return [false, `The dose rules cover paracetamol only; ${r.medication} cannot be checked, so it is not prescribed here.`];
  if (!/^500\s*mg\b.*tablet/i.test(r.formulation) || !/^oral$/i.test(r.route) || r.unit !== "mg") return [false, "The dose rules cover 500 mg tablets taken by mouth (oral), with the dose in mg."];
  const dose = Number(r.dose), hours = Number(r.frequency.match(/^every (\d+) hours?$/i)?.[1]), days = Number(r.duration.match(/^(\d+) days?$/i)?.[1]);
  if (dose !== 500 && dose !== 1000) return [false, "A dose is one or two 500 mg tablets: 500 mg or 1000 mg."];
  // A frequency or duration the rule cannot read is NaN, which fails every comparison below, so it blocks.
  const times = Math.floor(24 / hours), daily = dose * times;
  if (!(hours >= 4 && hours <= 24 && times <= 4 && daily <= 4000)) return [false, "Doses must be at least 4 hours apart, at most 4 in 24 hours and at most 4000 mg in 24 hours."];
  if (!(days >= 1 && days <= 3)) return [false, "The rule covers 1 to 3 days; longer needs medical review."];
  return [true, `${dose} mg every ${hours} hours for ${days} ${days === 1 ? "day" : "days"}: at most ${daily} mg in 24 hours, within the NHS adult limits (4000 mg and 4 doses in 24 hours, 3 days).`];
}
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
  if (encounter.medicationEntries) next.medicines = encounter.medicationEntries.map(m => `${m.name}${m.ingredient ? ` · ${m.ingredient}` : " · ingredient unknown"}${m.formulation ? ` · ${m.formulation}` : ""}${m.confirmed ? " · confirmed" : " · unconfirmed"}`);
  if (encounter.note) next.sources.push({ id: "clinical-note", title: "Clinician note · local session", kind: "record", date: `Encounter revision ${encounter.revision}`, synthetic: true, excerpt: encounter.note });
  return next;
}
/** Ingredients the interaction rules cover. */
const COVERED = ["salbutamol", "albuterol", "cetirizine"];
/**
 * A visit's medicines as the record lists them, each still to be confirmed. The ingredient and form are filled only where the
 * record's own words state them (a covered ingredient, a dosage form); otherwise they stay blank for the clinician to enter.
 */
export function defaultMedications(patient: Patient) {
  return patient.medicines.map((name, index) => ({
    id: `medicine-${index}`, name, ingredient: COVERED.find(word => new RegExp(`\\b${word}\\b`, "i").test(name)) ?? "",
    formulation: name.match(/\b(inhaler|tablet|caplet|capsule|syrup|solution|suspension)\b/i)?.[1]?.toLowerCase() ?? "", confirmed: false,
  }));
}
export function getPrescriptionChecks(encounter: Encounter, patient: Patient): PrescriptionCheck[] {
  const inputs = encounter.prescriptionInputs;
  const medicines = encounter.medicationEntries ?? defaultMedications(patient);
  const weight = Number(inputs?.weightKg);
  const check = (id: string, label: string, passed: boolean, yes: string, no: string): PrescriptionCheck => ({ id, label, status: passed ? "passed" : "blocked", detail: passed ? yes : no });
  const [dosed, doseDetail] = doseVerdict(parseRegimen(encounter.proposedMedicine));
  const recordedAllergy = /paracetamol|acetaminophen/i.test(patient.allergies ?? "");
  return [
    check("indication", "Indication & patient context", !patient.incomplete && /fever/i.test(patient.complaint), "Fever is documented in the recorded complaint; this is symptom relief, not treatment of a confirmed respiratory diagnosis.", "The rules need a documented fever and a complete intake before paracetamol can be prescribed."),
    check("regimen", "Bounded regimen", dosed && encounter.prescriptionScenario !== "unsupported", doseDetail, dosed ? "Demo scenario: this regimen is marked unsupported." : doseDetail),
    check("identity", "Medication identity", medicines.length > 0 && medicines.every(m => m.confirmed && !!m.ingredient.trim() && !!m.formulation.trim()), "The clinician confirmed every listed ingredient and formulation.", "Confirm each medication ingredient and formulation; unknown tablets cannot be checked."),
    check("coverage", "Interaction coverage", encounter.prescriptionScenario !== "unknown-coverage" && medicines.every(m => COVERED.includes(m.ingredient.trim().toLowerCase())), "Every medicine on this visit is one the interaction rules cover (salbutamol, cetirizine). This is rule coverage, not a clinical interaction clearance.", "One or more of this visit's medicines are outside what the interaction rules cover. No blanket safe result is available."),
    check("review", "Current medication review", encounter.medicationCheckedRevision === encounter.revision, `Review recorded at encounter revision ${encounter.revision}.`, "Rerun medication review after the latest context or regimen edit."),
    check("age-weight", "Adult age & weight", patient.age >= 18 && Number.isFinite(weight) && weight >= 50, `Adult, ${inputs?.weightKg} kg recorded.`, "Record a weight of at least 50 kg; the dose rules cover adults of 50 kg or more, and lower or unknown weights need a different regimen."),
    ...([ ["paracetamolAllergy", "Paracetamol allergy"], ["liverDisease", "Liver history"], ["kidneyDisease", "Kidney history"], ["alcoholRisk", "Alcohol risk"] ] as const).map(([key,label]) => key === "paracetamolAllergy" && recordedAllergy
      // The record outranks the answer on the card: a listed allergy blocks even when "No" was tapped.
      ? check(key, label, false, "", `The record lists this allergy: ${patient.allergies}. Paracetamol is not prescribed.`)
      : check(key, label, inputs?.[key] === "no", "Recorded as no by the clinician.", inputs?.[key] === "yes" ? "Positive risk recorded: this case is outside what the dose rules cover." : "History not recorded. Unknown is not a negative finding.")),
    check("prerequisite", "Prerequisite service", encounter.prescriptionScenario !== "failed-prerequisite", "The rules run inside Sona; no outside service is called.", "Demo scenario: the prerequisite service failed. Restore the standard scenario and retry."),
  ];
}
