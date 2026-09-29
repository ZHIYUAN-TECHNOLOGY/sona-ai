import { expect, test } from "bun:test";
import { patients } from "./fixtures";
import { emphasise, markTerms } from "./emphasis";

test("only the raised temperature, its fever and the allergen are marked", () => {
  const amelia = patients[0];
  expect(emphasise(amelia.complaint, amelia)).toBe("Cough for five days, with [[fever|caution]] since yesterday.");
  expect(emphasise("Allergy recorded: Penicillin. Temperature 38.1 °C.", amelia)).toBe("Allergy recorded: [[Penicillin|alert]]. Temperature [[38.1 °C|caution]].");
});

test("a hyphenated word is not its tail", () => {
  expect(markTerms("Non-severe, not severe.", [["severe", "alert"]])).toBe("Non-severe, not [[severe|alert]].");
});

test("a patient with no observations or allergy gets no marks", () => {
  const daniel = patients[1];
  expect(emphasise("Breathlessness with fever.", daniel)).toBe("Breathlessness with fever.");
});
