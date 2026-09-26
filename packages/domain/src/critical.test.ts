import { expect, test } from "bun:test";
import { criticalOf, elapsed } from "./critical";

test("a critical value is one of the lab's call-now limits, low or high; merely abnormal results are not", () => {
  expect(criticalOf({ test: "Potassium", value: "2.6", unit: "mmol/L" })).toBe("critical low");
  expect(criticalOf({ test: "Potassium", value: "6.8", unit: "mmol/L" })).toBe("critical high");
  expect(criticalOf({ test: "Potassium", value: "3.1", unit: "mmol/L" })).toBeUndefined();
  expect(criticalOf({ test: "Hb", value: "6.4", unit: "g/dL" })).toBe("critical low");
  expect(criticalOf({ test: "Sodium", value: "118", unit: "mmol/L" })).toBe("critical low");
  expect(criticalOf({ test: "Glucose", value: "26", unit: "mmol/L" })).toBe("critical high");
});

test("a value in another unit, or not a number, is never called critical by guesswork", () => {
  expect(criticalOf({ test: "Hb", value: "64", unit: "g/L" })).toBeUndefined();
  expect(criticalOf({ test: "Potassium", value: "haemolysed", unit: "mmol/L" })).toBeUndefined();
  expect(criticalOf({ test: "Troponin", value: "900", unit: "ng/L" })).toBeUndefined();
});

test("time to acknowledge reads like a stopwatch", () => {
  const at = new Date("2026-09-26T10:00:00Z");
  expect(elapsed(at, new Date("2026-09-26T10:00:42Z"))).toBe("0:42");
  expect(elapsed(at, new Date("2026-09-26T10:03:07Z"))).toBe("3:07");
  expect(elapsed(at, new Date("2026-09-26T11:02:00Z"))).toBe("62:00");
});
