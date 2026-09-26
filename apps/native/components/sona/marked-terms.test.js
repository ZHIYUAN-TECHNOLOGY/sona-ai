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

test("low risk, high certainty and non-severe disease never turn red", () => {
  expect(marks("Low risk, high certainty, for non-severe community-acquired pneumonia."))
    .toEqual([["community-acquired pneumonia", "finding"]]);
});
