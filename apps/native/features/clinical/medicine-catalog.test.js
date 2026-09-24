import { expect, test } from "bun:test";
import { formOf, resolveMedicine } from "./medicine-catalog";

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
