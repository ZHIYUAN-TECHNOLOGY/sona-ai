/**
 * Trusted medicine appearance catalogue. A model (or the fixture) names a medicine; the app
 * resolves how its thumbnail looks here, so no generated or guessed image ever reaches the page.
 * Appearances are illustrative dosage forms, not a specific brand's pack or imprint.
 *
 * ponytail: three authored entries plus form-only fallbacks; a formulary-backed lookup (RxNorm /
 * NPRA product IDs) replaces this when the backend exists.
 */
export type MedicineForm = "inhaler" | "tablet" | "caplet" | "capsule" | "liquid" | "unknown";
export type MedicineLook = { id: string; form: MedicineForm; body: string; accent: string; tint: string; label: string; identified: boolean };

const ENTRIES: MedicineLook[] = [
  { id: "salbutamol-inhaler", form: "inhaler", body: "#3F7FE0", accent: "#CBD3DF", tint: "rgba(36,91,204,0.10)", label: "Salbutamol metered-dose inhaler", identified: true },
  { id: "cetirizine-tablet", form: "tablet", body: "#FFFFFF", accent: "#DCE2EA", tint: "rgba(110,80,210,0.09)", label: "Cetirizine tablet", identified: true },
  { id: "paracetamol-tablet", form: "caplet", body: "#FFFFFF", accent: "#DCE2EA", tint: "rgba(20,140,130,0.10)", label: "Paracetamol 500 mg tablet", identified: true },
];
export const medicineIds = ENTRIES.map(entry => entry.id) as [string, ...string[]];

export function medicineById(id: string) { return ENTRIES.find(entry => entry.id === id); }

const FORMS: [RegExp, MedicineForm][] = [[/inhal|puff|mdi/, "inhaler"], [/caplet/, "caplet"], [/capsule/, "capsule"], [/syrup|liquid|solution|suspension/, "liquid"], [/tablet|tab\b/, "tablet"]];
export function formOf(formulation: string): MedicineForm {
  const text = formulation.toLowerCase();
  return FORMS.find(([pattern]) => pattern.test(text))?.[1] ?? "unknown";
}

/** Catalogue entry for an ingredient + formulation, else a neutral look for the reported form only. */
export function resolveMedicine(ingredient: string, formulation: string): MedicineLook {
  const form = formOf(formulation);
  const key = ingredient.trim().toLowerCase().replace(/^albuterol$/, "salbutamol");
  const entry = ENTRIES.find(item => item.id.startsWith(`${key}-`) && (item.form === form || (item.form === "caplet" && form === "tablet")));
  return entry ?? { id: `form-${form}`, form, body: "#FFFFFF", accent: "#DCE2EA", tint: "rgba(20,28,40,0.05)", label: form === "unknown" ? "Unknown form" : `${form} (product not identified)`, identified: false };
}
