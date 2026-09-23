import { describe, expect, test } from "bun:test";
import { lookupInteractionPairs, normalizeIngredient } from "./interaction-lookup";

const medicine = (id, ingredient, confirmed = true) => ({ id, ingredient, name: ingredient, formulation: "recorded formulation", confirmed });
describe("bounded sourced interaction lookup", () => {
  test("normalizes salbutamol and evaluates the entered proposed beta-blocker", () => {
    const pairs = lookupInteractionPairs([medicine("reliever", " Salbutamol sulphate ")], "Metoprolol tartrate");
    expect(normalizeIngredient("  ALBUTEROL   SULFATE ")).toBe("albuterol");
    expect(pairs).toHaveLength(1);
    expect(pairs[0].status).toBe("alert");
    expect(pairs[0].sourceId).toBe("beta-reference");
    expect(pairs[0].right).toContain("proposed");
  });
  test("recognizes a sourced class pair in either recorded order", () => {
    for (const entries of [[medicine("a", "propranolol"), medicine("b", "albuterol")], [medicine("b", "albuterol"), medicine("a", "propranolol")]]) expect(lookupInteractionPairs(entries, "")[0].status).toBe("alert");
  });
  test("does not infer unresolved ingredients from names or unconfirmed records", () => {
    expect(lookupInteractionPairs([medicine("a", "salbutamol", false)], "propranolol")[0].status).toBe("unresolved");
    expect(lookupInteractionPairs([medicine("a", "blue inhaler")], "propranolol")[0].status).toBe("unresolved");
    expect(lookupInteractionPairs([{ ...medicine("a", "salbutamol"), formulation: "" }], "propranolol")[0].status).toBe("unresolved");
    expect(normalizeIngredient("not albuterol")).toBeUndefined();
  });
  test("an alert does not clear other pairs or imply blanket coverage", () => {
    const pairs = lookupInteractionPairs([medicine("a", "salbutamol"), medicine("b", "propranolol")], "paracetamol");
    expect(pairs.filter(pair => pair.status === "alert")).toHaveLength(1);
    expect(pairs.filter(pair => pair.status === "uncovered")).toHaveLength(2);
    expect(pairs.some(pair => pair.status === "safe")).toBe(false);
  });
  test("the default reported pair stays uncovered after confirmation", () => {
    expect(lookupInteractionPairs([medicine("a", "salbutamol"), medicine("b", "cetirizine")]).every(pair => pair.status === "uncovered")).toBe(true);
  });
});
