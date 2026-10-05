import { expect, test } from "bun:test";
import { deidentifiedText, draftText, emptyReadText, keptByText, labelMeaning, readerText, sampleText } from "./sample-label";

test("a model's answer kept from earlier says when it was drafted", () => {
  expect(draftText("gemma-4-26b-a4b")).toBe("AI draft · Gemma · check before acting");
  const kept = draftText("medgemma-27b", "2026-10-05T06:02:00Z");
  expect(kept).toStartWith("AI draft · MedGemma · drafted earlier, Mon");
  expect(kept).toContain("5 Oct");
  expect(kept).toEndWith("14:02 · check before acting"); // Malaysia's clock
});

test("who read a patient's words is said only when it was not a model alone", () => {
  expect(readerText({ source: "model", model: "gemma", decidedBy: "model" })).toBeUndefined();
  expect(readerText({ source: "model", model: "gemma", decidedBy: "rules" })).toBe("Safety rule");
  expect(readerText({ source: "fixture" })).toBe("Rule-based");
  expect(readerText({ source: "none" })).toBe("Not triaged");
  expect(readerText({ source: "unknown" })).toBeUndefined();
  expect(readerText(undefined)).toBeUndefined();
  // A check-in reply keeps the model's name as its source.
  expect(readerText({ source: "gemma-4-26b-a4b", decidedBy: "model" })).toBeUndefined();
  expect(readerText({ source: "gemma-4-26b-a4b", decidedBy: "rules" })).toBe("Safety rule");
  expect(readerText({ source: "fixture", decidedBy: "rules" })).toBe("Rule-based");
});

test("what was kept as sent names its maker, or makes no claim", () => {
  expect(keptByText({ source: "model", model: "gemma-4-26b-a4b" }, "suggested by")).toBe("suggested by Gemma");
  expect(keptByText({ source: "fixture" }, "suggested by")).toBe("Rule-based");
  expect(keptByText({ source: "unknown" }, "drafted by")).toBeUndefined();
  expect(keptByText(undefined, "drafted by")).toBeUndefined();
});

test("a scan says who removed the name only when something left the server", () => {
  expect(deidentifiedText("none")).toBeUndefined();
  expect(deidentifiedText(undefined)).toBeUndefined();
  expect(deidentifiedText("rules")).toBe("Name removed before reading · Rule-based");
  expect(deidentifiedText("openmed-pii")).toBe("Name removed before reading · openmed-pii");
});

test("an empty findings list is a model's clean read or an unread film, never a guess", () => {
  expect(emptyReadText({ source: "model", model: "medgemma-4b", found: 0 })).toEqual({ text: "Read by MedGemma · nothing found", unread: false });
  expect(emptyReadText({ source: "model", model: "medgemma-4b", found: 2 })).toBeUndefined();
  expect(emptyReadText({ source: "fixture", found: 0 })).toEqual({ text: "This film has not been read by a model", unread: true });
  expect(emptyReadText(null)).toEqual({ text: "This film has not been read by a model", unread: true });
  expect(emptyReadText({ source: "unknown", found: 0 })).toBeUndefined();
  expect(emptyReadText(undefined)).toBeUndefined();
});

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

test("a label says what it means in place, as the About data sheet does", () => {
  expect(labelMeaning({ judge: true, model: true })).toBe("Written by a model: check it before acting.");
  expect(labelMeaning({ judge: false, rule: true })).toBe("Fixed rules worked this out, not a model.");
  expect(labelMeaning({ judge: false })).toBe("An authored example, shown until the AI model is switched on.");
  expect(labelMeaning({ judge: false, waking: 3 })).toBe("An authored example, shown until the model has started.");
  // The judge build has no samples: never "an authored example".
  expect(labelMeaning({ judge: true })).not.toContain("authored");
});
