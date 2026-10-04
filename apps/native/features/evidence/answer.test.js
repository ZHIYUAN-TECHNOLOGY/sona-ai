import { expect, test } from "bun:test";
import { basis, calmTerms, fallbackNote, forPatient, searchedLine, sections, stepLines, strength, unanswered } from "./answer";

const refs = [
  { n: 1, design: "Guideline" }, { n: 2, design: "Trial" }, { n: 3, design: "Trial" }, { n: 4, design: "Library" },
];

test("the checklist follows the server's steps: each is active until the next starts", () => {
  expect(stepLines([])).toEqual([{ key: "search", text: "Searching PubMed and your library…", done: false }]);
  const read = [{ step: "search" }, { step: "read", studies: 3, passages: 1 }];
  expect(stepLines(read)).toEqual([
    { key: "search", text: "Searched PubMed and your library", done: true },
    { key: "read", text: "Reading 4 sources…", done: false },
  ]);
  expect(stepLines([...read, { step: "write" }]).map(s => [s.text, s.done])).toEqual([["Searched PubMed and your library", true], ["Read 4 sources", true], ["Writing the answer…", false]]);
  expect(stepLines([{ step: "search" }, { step: "read", studies: 0, passages: 0 }])[1].text).toBe("No sources found");
});

test("what the answer rests on, strongest first, and the folded summary", () => {
  const claims = [{ text: "a", cites: [1, 3] }, { text: "b", cites: [2, 3] }];
  expect(basis(claims, refs)).toBe("From 1 guideline and 2 randomised trials");
  expect(basis([{ text: "c", cites: [4] }], refs)).toBe("From 1 library passage");
  expect(basis([], refs)).toBe("");
  expect(searchedLine(claims, refs)).toBe("PubMed and your library · 4 sources · 3 cited");
  expect(strength("Narrative review")).toBe("Review");
});

test("claims sit under evidence, dose and harms, titled only when there is more than one", () => {
  const one = sections([{ text: "a", cites: [1] }, { text: "b", cites: [1], topic: "evidence" }]);
  expect(one).toEqual([{ topic: "evidence", claims: [{ text: "a", cites: [1] }, { text: "b", cites: [1], topic: "evidence" }] }]);
  const three = sections([{ text: "h", cites: [1], topic: "harms" }, { text: "d", cites: [1], topic: "dose" }, { text: "e", cites: [1] }]);
  expect(three.map(s => [s.title, s.claims.map(c => c.text)])).toEqual([["Evidence", ["e"]], ["Dose", ["d"]], ["Harms", ["h"]]]);
});

test("a pneumonia answer is tied to the patient only when CURB-65 is complete and clear-cut", () => {
  const low = { score: 0, risk: "Low risk · home treatment is usually suitable" };
  expect(forPatient("Steroids for CAP?", "Amelia", low)).toBe("For Amelia: CURB-65 0, low risk, so the non-severe evidence applies.");
  expect(forPatient("Steroids for asthma?", "Amelia", low)).toBeUndefined();
  expect(forPatient("Steroids for pneumonia?", "Amelia", { score: 2, risk: "Moderate risk" })).toBeUndefined();
  expect(forPatient("Steroids for pneumonia?", "Amelia", { score: 1 })).toBeUndefined();
  expect(forPatient("Steroids for pneumonia?", "Amelia", null)).toBeUndefined();
});

test("evidence text keeps its key terms but never paints a general finding as a patient's alert", () => {
  expect(calmTerms("Not routinely: steroids are for severe pneumonia treated in intensive care."))
    .toBe("Not routinely: [[steroids|medicine]] are for [[severe pneumonia|finding]] treated in [[intensive care|finding]].");
  expect(calmTerms("No key terms here.")).toBe("No key terms here.");
});

test("a model that did not answer is said as that, or as starting; never as too little evidence or a sample", () => {
  const failed = { source: "fixture", enough: false, claims: [] };
  expect(unanswered(failed)).toBe("Sona's model did not answer. Ask again in a moment.");
  expect(unanswered(failed, 3)).toBe("Sona's model is starting, about 3 min. Ask again then.");
  // A model's own verdict, a general answer, the sample with no model configured, and no answer yet keep their own wording.
  expect(unanswered({ source: "medgemma-27b", enough: false })).toBeUndefined();
  expect(unanswered({ source: "fixture", enough: false, general: "Usually 5 days." })).toBeUndefined();
  expect(unanswered({ source: "fixture", enough: true })).toBeUndefined();
  expect(unanswered({ source: "cached", enough: true })).toBeUndefined();
  expect(unanswered(undefined)).toBeUndefined();
});

test("an answer made with less than usual says so in one plain line; a fallback that changed nothing on screen is not mentioned", () => {
  const study = { kind: "study" }, passage = { kind: "library" };
  expect(fallbackNote({ references: [study, passage], retrieval: "hybrid", ranked: true })).toBeUndefined();
  expect(fallbackNote({ references: [study, passage], retrieval: "hybrid" })).toBeUndefined();
  expect(fallbackNote({ references: [study, passage], retrieval: "hybrid", ranked: false })).toBe("Library passages are not ranked for relevance: Sona's ranking model did not answer.");
  // Keywords alone is the larger fallback, so it is the one said.
  expect(fallbackNote({ references: [passage], retrieval: "keywords", ranked: false })).toBe("Your library was searched by keywords only: Sona's search model did not answer.");
  // No library passage among the sources: nothing of the library's search shows, so nothing is said of it.
  expect(fallbackNote({ references: [study], retrieval: "keywords", ranked: false })).toBeUndefined();
  expect(fallbackNote({ references: [study], cutShort: true })).toBe("Sona's model stopped before finishing, so this answer may be missing a point.");
  expect(fallbackNote(undefined)).toBeUndefined();
});
