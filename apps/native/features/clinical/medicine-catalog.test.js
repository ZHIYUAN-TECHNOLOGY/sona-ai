import { expect, test } from "bun:test";
import { defaultMedications } from "@/features/encounter/clinical-state";
import { patients } from "@/features/encounter/fixtures";
import { entryFor, formOf, resolveMedicine } from "./medicine-catalog";

test("authored medicines resolve to their catalogue look", () => {
  expect(resolveMedicine("salbutamol", "inhaler").id).toBe("salbutamol-inhaler");
  expect(resolveMedicine("Albuterol", "inhaler").id).toBe("salbutamol-inhaler");
  expect(resolveMedicine("paracetamol", "500 mg tablet").id).toBe("paracetamol-tablet");
});

test("unknown products fall back to the reported form, never another medicine", () => {
  const look = resolveMedicine("ibuprofen", "tablet");
  expect(look.identified).toBe(false);
  expect(look.form).toBe("tablet");
  expect(resolveMedicine("salbutamol", "syrup").identified).toBe(false);
  expect(formOf("")).toBe("unknown");
});

test("Laya's medicine pick finds the visit's own reported medicine, or none", () => {
  const amelia = defaultMedications(patients[0]), daniel = defaultMedications(patients[1]);
  expect(entryFor("salbutamol-inhaler", amelia)?.name).toBe("Salbutamol inhaler, as needed");
  // The record names no form for the cetirizine, so it is not a tablet until the clinician says so.
  expect(entryFor("cetirizine-tablet", amelia)).toBeUndefined();
  expect(entryFor("cetirizine-tablet", amelia.map(m => ({ ...m, formulation: m.formulation || "tablet" })))?.name).toBe("Cetirizine, patient-reported");
  // The proposed paracetamol is not a reported medicine, and an unknown tablet is never guessed to be one.
  expect(entryFor("paracetamol-tablet", amelia)).toBeUndefined();
  expect(entryFor("cetirizine-tablet", daniel)).toBeUndefined();
});
