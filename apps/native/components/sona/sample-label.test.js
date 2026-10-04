import { expect, test } from "bun:test";
import { sampleText } from "./sample-label";

test("outside the judge build the label is today's: a sample or rule-based, and why", () => {
  expect(sampleText({ judge: false, what: "briefing" })).toBe("Sample · briefing model not switched on");
  expect(sampleText({ judge: false, rule: true, what: "scribe" })).toBe("Rule-based · scribe model not switched on");
  expect(sampleText({ judge: false, rule: true })).toBe("Rule-based");
  expect(sampleText({ judge: false, waking: 3 })).toBe("Sample for now · Sona's model is starting, about 3 min");
  expect(sampleText({ judge: false, what: "coding", answerError: "Network request failed" })).toBe("Sample · coding model not switched on");
});

test("the judge build never says Sample: the model is starting, or it did not answer, and why when known", () => {
  expect(sampleText({ judge: true, what: "briefing" })).toBe("Sona's model did not answer");
  expect(sampleText({ judge: true, waking: 3 })).toBe("Sona's model is starting, about 3 min");
  expect(sampleText({ judge: true, rule: true, what: "scribe", waking: 2 })).toBe("Rule-based for now · Sona's model is starting, about 2 min");
  expect(sampleText({ judge: true, rule: true, what: "coding" })).toBe("Rule-based · Sona's model did not answer");
  expect(sampleText({ judge: true, rule: true, what: "coding", answerError: "Network request failed" })).toBe("Rule-based · Sona's model did not answer: Network request failed");
  // Fixed rules that no model replaces are the answer, in every build.
  expect(sampleText({ judge: true, rule: true })).toBe("Rule-based");
});

test("a fallback after a failed call says the call failed, in every build", () => {
  for (const judge of [true, false]) expect(sampleText({ judge, rule: true, what: "scribe", error: "Network request failed" })).toBe("Rule-based · the scribe model could not be reached: Network request failed");
});
