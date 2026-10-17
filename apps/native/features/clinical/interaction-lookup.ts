import type { MedicationEntry } from "@/features/encounter/types";

export const interactionSource = {
  id: "beta-reference",
  url: "https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=825975b1-a4a9-78ca-e053-2a91aa0a3948",
  title: "DailyMed · Albuterol HFA · section 7.1",
};
export const betaBlockerAlert = {
  summary: "Beta-blockers can reduce albuterol's airway effect and may cause severe bronchospasm in people with asthma.",
  qualifiers: "The label says beta-blockers are generally avoided in asthma. If no acceptable alternative exists, a clinician may consider a cardioselective agent with caution. This alert does not recommend a substitution.",
};
const ingredients: Record<string, string> = {
  albuterol: "albuterol", "albuterol sulfate": "albuterol", "albuterol sulphate": "albuterol",
  salbutamol: "albuterol", "salbutamol sulfate": "albuterol", "salbutamol sulphate": "albuterol",
  propranolol: "propranolol", "propranolol hydrochloride": "propranolol",
  metoprolol: "metoprolol", "metoprolol tartrate": "metoprolol", "metoprolol succinate": "metoprolol",
  cetirizine: "cetirizine", "cetirizine hydrochloride": "cetirizine",
  paracetamol: "paracetamol", acetaminophen: "paracetamol",
};
export function normalizeIngredient(value: string): string | undefined { return ingredients[value.trim().toLowerCase().replace(/\s+/g, " ")]; }
export type InteractionPair = { id: string; left: string; right: string; status: "alert" | "unresolved" | "uncovered"; detail: string; sourceId?: string };

/** One sourced class-interaction rule; no no-match result represents clinical clearance. */
export function lookupInteractionPairs(medicines: MedicationEntry[], proposed = "Paracetamol"): InteractionPair[] {
  const items = medicines.map(medicine => ({ id: medicine.id, name: medicine.name, ingredient: medicine.confirmed && medicine.formulation.trim() ? normalizeIngredient(medicine.ingredient) : undefined }));
  if (proposed.trim()) items.push({ id: "proposed", name: `${proposed.trim()} · proposed ingredient`, ingredient: normalizeIngredient(proposed) });
  const pairs: InteractionPair[] = [];
  const blockers = new Set(["propranolol", "metoprolol"]);
  for (let leftIndex = 0; leftIndex < items.length; leftIndex++) for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex++) {
    const left = items[leftIndex]!, right = items[rightIndex]!;
    const base = { id: `${left.id}:${right.id}`, left: left.name, right: right.name };
    if (!left.ingredient || !right.ingredient) { pairs.push({ ...base, status: "unresolved", detail: "Confirm both ingredients and formulations. Ambiguous names are not inferred from a brand or medicine description." }); continue; }
    if ((left.ingredient === "albuterol" && blockers.has(right.ingredient)) || (right.ingredient === "albuterol" && blockers.has(left.ingredient))) pairs.push({ ...base, status: "alert", detail: betaBlockerAlert.summary, sourceId: interactionSource.id });
    else pairs.push({ ...base, status: "uncovered", detail: "This pair is outside the single-rule fixture coverage. No clinical interaction conclusion is available." });
  }
  return pairs;
}
