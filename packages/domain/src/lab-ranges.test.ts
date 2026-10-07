import { expect, test } from "bun:test";
import { rangeFlagOf, rangeWhy } from "./lab-ranges";

test("a result outside the usual adult range reads high or low; one inside it carries no flag", () => {
  expect(rangeFlagOf({ test: "CRP", value: "86", unit: "mg/L" })).toBe("high");
  expect(rangeFlagOf({ test: "WBC", value: "7.2", unit: "x10^9/L" })).toBeUndefined();
  expect(rangeFlagOf({ test: "White cell count", value: "14.1", unit: "10^9/L" })).toBe("high");
  expect(rangeFlagOf({ test: "Potassium", value: "3.1", unit: "mmol/L" })).toBe("low");
  expect(rangeFlagOf({ test: "Creatinine", value: "180", unit: "µmol/L" })).toBe("high");
  expect(rangeFlagOf({ test: "Creatinine", value: "1.0", unit: "mg/dL" })).toBeUndefined();
  expect(rangeFlagOf({ test: "HbA1c", value: "7.1", unit: "%" })).toBe("high");
  expect(rangeFlagOf({ test: "HbA1c", value: "53", unit: "mmol/mol" })).toBe("high");
});

test("haemoglobin uses the patient's sex when known and the widest adult range when not", () => {
  expect(rangeFlagOf({ test: "Hb", value: "12.8", unit: "g/dL", sex: "Male" })).toBe("low");
  expect(rangeFlagOf({ test: "Hb", value: "12.8", unit: "g/dL", sex: "Female" })).toBeUndefined();
  expect(rangeFlagOf({ test: "Haemoglobin", value: "16", unit: "g/dL", sex: "Female" })).toBe("high");
  expect(rangeFlagOf({ test: "Hb", value: "16", unit: "g/dL" })).toBeUndefined();
});

test("an unknown test, another unit or a value that is not a number is never flagged by guesswork", () => {
  expect(rangeFlagOf({ test: "Troponin", value: "900", unit: "ng/L" })).toBeUndefined();
  expect(rangeFlagOf({ test: "CRP", value: "86", unit: "mg/dL" })).toBeUndefined();
  expect(rangeFlagOf({ test: "CRP", value: "86" })).toBeUndefined();
  expect(rangeFlagOf({ test: "CRP", value: "<5", unit: "mg/L" })).toBeUndefined();
  expect(rangeFlagOf({ test: "Potassium", value: "", unit: "mmol/L" })).toBeUndefined();
});

test("the reason names the range the value fell outside", () => {
  expect(rangeWhy({ test: "CRP", value: "86", unit: "mg/L" })).toBe("CRP 86 mg/L is above the usual adult range of up to 5 mg/L");
  expect(rangeWhy({ test: "Potassium", value: "3.1", unit: "mmol/L" })).toBe("Potassium 3.1 mmol/L is below the usual adult range of 3.5 to 5.1 mmol/L");
  expect(rangeWhy({ test: "WBC", value: "7.2", unit: "x10^9/L" })).toBeUndefined();
});
