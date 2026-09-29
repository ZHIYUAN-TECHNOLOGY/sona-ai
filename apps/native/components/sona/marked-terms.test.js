import { expect, test } from "bun:test";
import { segments } from "./marked-terms";

const marks = text => segments(text).filter(s => s.mark).map(s => [s.text, s.mark]);

test("medicines, conditions and symptoms each get their own colour", () => {
  expect(marks("Oral azithromycin 2 more days for community-acquired pneumonia with fever."))
    .toEqual([["azithromycin", "medicine"], ["community-acquired pneumonia", "finding"], ["fever", "symptom"]]);
});

test("allergies, severe disease and abnormal results are alerts, not mere cautions", () => {
  expect(marks("Penicillin allergy reported; septic shock is excluded; potassium low."))
    .toEqual([["Penicillin allergy", "alert"], ["septic shock", "alert"], ["potassium low", "alert"]]);
});

test("a longer term wins over the shorter one inside it, and unrelated words stay plain", () => {
  expect(marks("Heart failure, not a failure of the plan.")).toEqual([["Heart failure", "finding"]]);
  expect(marks("The clinic review is booked.")).toEqual([]);
});

test("explicit markup from a model response overrides the dictionary", () => {
  expect(marks("Give [[co-amoxiclav|medicine]] unless [[anaphylaxis|alert]].")).toEqual([["co-amoxiclav", "medicine"], ["anaphylaxis", "alert"]]);
});

test("text with explicit markup colours only those terms, not dictionary words around them", () => {
  expect(marks("Cough for five days, with [[fever|caution]] since yesterday.")).toEqual([["fever", "caution"]]);
  expect(segments("Cough, [[fever|caution]].").map(s => s.text).join("")).toBe("Cough, fever.");
});

test("low risk, high certainty and non-severe disease never turn red", () => {
  expect(marks("Low risk, high certainty, for non-severe community-acquired pneumonia."))
    .toEqual([["community-acquired pneumonia", "finding"]]);
});

test("incidental findings on a film are findings, with their size", () => {
  expect(marks("Follow up 9 mm nodule; borderline heart size, no cardiomegaly or effusion."))
    .toEqual([["9 mm nodule", "finding"], ["borderline heart size", "finding"], ["cardiomegaly", "finding"], ["effusion", "finding"]]);
});

test("an abbreviated analyte still marks an abnormal result", () => {
  expect(marks("Act on low Hb (9.8 g/dL).")).toEqual([["low Hb", "alert"]]);
});

test("a symptom that is absent or denied is not highlighted as present", () => {
  expect(marks("Observations: Confusion absent, no fever, denies chest pain; cough since Monday.")).toEqual([["cough", "symptom"]]);
});
