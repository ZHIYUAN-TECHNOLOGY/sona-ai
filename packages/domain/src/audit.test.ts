import { expect, test } from "bun:test";
import { codingGaps } from "./audit";

const note = [
  { id: "s1", text: "Day 2 of IV antibiotics for pneumonia." },
  { id: "s2", text: "Type 2 diabetes, on metformin." },
];
const casemix = { "D64.9": { weight: 0.16, baseRateCents: 400_000 }, "E87.1": { weight: 0.24, baseRateCents: 400_000 } };

test("anaemia in the labs but not the note is a gap worth RM 640 at weight 0.16 and a RM 4,000 base rate", () => {
  const gaps = codingGaps({ sentences: note, codes: ["J18.9", "E11.9"], labs: [{ test: "Haemoglobin", value: "9.8", unit: "g/dL", sourceId: "lab-hb-1" }] }, casemix);
  expect(gaps).toEqual([{
    gap: "Anaemia in the labs, not the note", fromCode: null, toCode: "D64.9", riskCents: 64_000, sourceId: "lab-hb-1",
    query: "Haemoglobin is 9.8 g/dL. Is anaemia a diagnosis you want recorded?",
  }]);
});

test("no anaemia gap when the note names it, a code covers it, or the haemoglobin is normal", () => {
  const hb = [{ test: "Hb", value: "9.8", unit: "g/dL", sourceId: "lab-hb-1" }];
  expect(codingGaps({ sentences: [...note, { id: "s3", text: "Iron-deficiency anemia, start ferrous sulfate." }], codes: [], labs: hb }, casemix)).toEqual([]);
  expect(codingGaps({ sentences: note, codes: ["D50.9"], labs: hb }, casemix)).toEqual([]);
  expect(codingGaps({ sentences: note, codes: [], labs: [{ test: "Haemoglobin", value: "13.4", unit: "g/dL", sourceId: "lab-hb-2" }] }, casemix)).toEqual([]);
});

test("a result in an unexpected unit is not read as abnormal", () => {
  expect(codingGaps({ sentences: note, codes: [], labs: [{ test: "Haemoglobin", value: "98", unit: "g/L", sourceId: "lab-hb-3" }, { test: "Haemoglobin", value: "9.8", unit: "mmol/L", sourceId: "lab-hb-4" }] }, casemix)).toEqual([]);
});

test("low sodium without hyponatraemia in the note is a gap; a code missing from casemix carries no value", () => {
  const gaps = codingGaps({ sentences: note, codes: [], labs: [{ test: "Sodium", value: "126", unit: "mmol/L", sourceId: "lab-na-1" }] }, {});
  expect(gaps).toEqual([{
    gap: "Hyponatraemia in the labs, not the note", fromCode: null, toCode: "E87.1", riskCents: 0, sourceId: "lab-na-1",
    query: "Sodium is 126 mmol/L. Is hyponatraemia a diagnosis you want recorded?",
  }]);
});
