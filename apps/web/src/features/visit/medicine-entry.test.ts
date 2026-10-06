// @ts-ignore -- apps/web has no Bun types installed; drop this line once @types/bun is a devDependency.
import { expect, test } from "bun:test";

import { entryProblem, regimenOf } from "./medicine-entry";

const regimen = { medication: "Paracetamol", formulation: "500 mg tablets", dose: "1000", unit: "mg", route: "by mouth", frequency: "every 6 hours", duration: "3 days" };

test("a complete regimen becomes the line the server's rules read", () => {
  expect(regimenOf(regimen)).toBe("Paracetamol 500 mg tablets · 1000 mg · by mouth · every 6 hours · 3 days");
});

test("a regimen with a missing or malformed part is not saved", () => {
  expect(regimenOf({ ...regimen, duration: " " })).toBeUndefined();
  expect(regimenOf({ ...regimen, formulation: "tablets" })).toBeUndefined();
  expect(regimenOf({ ...regimen, dose: "two" })).toBeUndefined();
});

test("an entry needs a name, and an ingredient and form before it is confirmed", () => {
  expect(entryProblem({ name: " ", ingredient: "", formulation: "", confirmed: false })).toBeDefined();
  expect(entryProblem({ name: "Ventolin", ingredient: "", formulation: "inhaler", confirmed: true })).toBeDefined();
  expect(entryProblem({ name: "Ventolin", ingredient: "", formulation: "", confirmed: false })).toBeUndefined();
  expect(entryProblem({ name: "Ventolin", ingredient: "salbutamol", formulation: "inhaler", confirmed: true })).toBeUndefined();
});
