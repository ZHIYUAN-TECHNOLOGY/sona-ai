import { expect, test } from "bun:test";
import { segments } from "./marked-terms";

const marks = text => segments(text).filter(s => s.mark).map(s => [s.text, s.mark]);

test("medicines, conditions and symptoms each get their own colour", () => {
  expect(marks("Oral azithromycin 2 more days for community-acquired pneumonia with fever."))
    .toEqual([["azithromycin", "medicine"], ["community-acquired pneumonia", "condition"], ["fever", "symptom"]]);
});

test("allergies, severe disease and abnormal results are warnings, not mere cautions", () => {
  expect(marks("Penicillin allergy reported; septic shock is excluded; potassium low."))
    .toEqual([["Penicillin allergy", "warning"], ["septic shock", "warning"], ["potassium low", "warning"]]);
});

test("a longer term wins over the shorter one inside it, and unrelated words stay plain", () => {
  expect(marks("Heart failure, not a failure of the plan.")).toEqual([["Heart failure", "condition"]]);
  expect(marks("The clinic review is booked.")).toEqual([]);
});

test("explicit markup from a model response overrides the dictionary", () => {
  expect(marks("Give [[co-amoxiclav|medicine]] unless [[anaphylaxis|alert]].")).toEqual([["co-amoxiclav", "medicine"], ["anaphylaxis", "warning"]]);
});

test("text with explicit markup colours only those terms, not dictionary words around them", () => {
  expect(marks("Cough for five days, with [[fever|caution]] since yesterday.")).toEqual([["fever", "caution"]]);
  expect(segments("Cough, [[fever|caution]].").map(s => s.text).join("")).toBe("Cough, fever.");
});

test("low risk, high certainty and non-severe disease never turn red", () => {
  expect(marks("Low risk, high certainty, for non-severe community-acquired pneumonia."))
    .toEqual([["community-acquired pneumonia", "condition"]]);
});

test("incidental findings on a film are findings, with their size", () => {
  expect(marks("Follow up 9 mm nodule; borderline heart size, no cardiomegaly or effusion."))
    .toEqual([["9 mm nodule", "condition"], ["borderline heart size", "condition"], ["cardiomegaly", "condition"], ["effusion", "condition"]]);
});

test("an abbreviated analyte still marks an abnormal result", () => {
  expect(marks("Act on low Hb (9.8 g/dL).")).toEqual([["low Hb", "warning"]]);
});

test("a symptom that is absent or denied is not highlighted as present", () => {
  expect(marks("Observations: Confusion absent, no fever, denies chest pain; cough since Monday.")).toEqual([["cough", "symptom"]]);
});

test("a measurement out of range is marked with its value, amber then red; one in range stays plain", () => {
  expect(marks("Oxygen saturation 97% on room air; temperature 38.1 °C; pulse 96 bpm."))
    .toEqual([["temperature 38.1 °C", "caution"]]);
  expect(marks("Temperature 39.4 °C, oxygen saturation 89%, respiratory rate 18 /min, systolic 124 mmHg."))
    .toEqual([["Temperature 39.4 °C", "warning"], ["oxygen saturation 89%", "warning"]]);
});

test("a full mental test score is not a symptom to look at", () => {
  expect(marks("Observations: Confusion AMT 10/10, Urea 5.1 mmol/L.")).toEqual([]);
  expect(marks("Confusion AMT 6/10.")).toEqual([["Confusion", "symptom"]]);
});

test("a spoken consultation's signs, a bare saturation and the safety-net warning are marked", () => {
  expect(marks("Temperature 38.1, pulse 96, saturation 91% on room air."))
    .toEqual([["Temperature 38.1", "caution"], ["saturation 91%", "warning"]]);
  expect(marks("Coughing, yellow phlegm and shivering; chest tightness on the stairs."))
    .toEqual([["Coughing", "symptom"], ["phlegm", "symptom"], ["shivering", "symptom"], ["chest tightness", "symptom"]]);
  expect(marks("If her lips turn bluish, go straight to emergency."))
    .toEqual([["lips turn bluish", "warning"], ["straight to emergency", "warning"]]);
});

test("a model's marks alone colour its text, each at its first mention outside a longer one; none leaves it plain", () => {
  const terms = [{ text: "potassium", kind: "test" }, { text: "low potassium of 3.1 mmol/L", kind: "warning" }, { text: "oral potassium", kind: "medicine" }, { text: "twice daily", kind: "dose" }, { text: "not in the text", kind: "caution" }];
  const text = "Daniel has a low potassium of 3.1 mmol/L; give oral potassium twice daily and recheck potassium.";
  expect(segments(text, terms).filter(s => s.mark).map(s => [s.text, s.mark]))
    .toEqual([["low potassium of 3.1 mmol/L", "warning"], ["oral potassium", "medicine"], ["twice daily", "dose"], ["potassium", "test"]]);
  expect(segments(text, terms).map(s => s.text).join("")).toBe(text);
  // The dictionary would colour cough and fever; the model chose nothing.
  expect(marks("Cough and fever.")).toHaveLength(2);
  expect(segments("Cough and fever.", []).filter(s => s.mark)).toEqual([]);
});

test("markup in Sona Care's and older Pro names reads as today's kinds", () => {
  expect(marks("[[pneumonia|finding]], [[sepsis|alert]], [[twice daily|when]], [[U&E|test]].")).toEqual([["pneumonia", "condition"], ["sepsis", "warning"], ["twice daily", "dose"], ["U&E", "test"]]);
});
