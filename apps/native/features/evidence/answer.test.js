import { expect, test } from "bun:test";
import { basis, calmTerms, forPatient, searchedLine, sections, stepLines, strength } from "./answer";

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
