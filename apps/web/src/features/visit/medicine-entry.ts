import { parseRegimen, regimenLine } from "@sona-ai/domain/prescribing";
import type { MedicationEntry } from "@sona-ai/domain/types";

/** The parts of a proposed regimen, in the order the server's one-line form holds them. */
export const REGIMEN = [
  ["medication", "Medicine", "Paracetamol"], ["formulation", "Strength and form", "500 mg tablets"], ["dose", "Dose", "1000"], ["unit", "Unit", "mg"],
  ["route", "Route", "by mouth"], ["frequency", "Frequency", "every 6 hours"], ["duration", "Duration", "3 days"],
] as const;
export type RegimenDraft = Record<(typeof REGIMEN)[number][0], string>;
export const NO_REGIMEN: RegimenDraft = { medication: "", formulation: "", dose: "", unit: "", route: "", frequency: "", duration: "" };

/** The regimen as the one line the server's rules read, or undefined when a part is missing or malformed. */
export const regimenOf = (draft: RegimenDraft) => {
  const line = regimenLine(draft);
  return parseRegimen(line) ? line : undefined;
};
/** What stops an entry being saved: the identity check needs an ingredient and a form before an entry counts as confirmed. */
export const entryProblem = (e: Pick<MedicationEntry, "name" | "ingredient" | "formulation" | "confirmed">) =>
  !e.name.trim() ? "Enter the medicine's name."
    : e.confirmed && !(e.ingredient.trim() && e.formulation.trim()) ? "A confirmed medicine needs its ingredient and its form." : undefined;
