import { expect, test } from "bun:test";
import { patients } from "./fixtures";
import { leadFor } from "./lead";

const amelia = patients.find(p => p.id === "SYN-1042");
const daniel = patients.find(p => p.id === "SYN-1086");
const med = (confirmed, over = {}) => ({ confirmed, ingredient: "Salbutamol", formulation: "Inhaler", ...over });
const plain = text => text?.replace(/\[\[([^|]+)\|\w+\]\]/g, "$1");

test("the medication lead counts what the card counts, and never says 'nothing cleared' above 'all confirmed'", () => {
  expect(plain(leadFor("medication", amelia, { medicines: [med(true), med(true)] }))).toBe("Both medicines are confirmed. Penicillin allergy still needs confirming.");
  expect(plain(leadFor("medication", amelia, { medicines: [med(true), med(false)] }))).toBe("1 of 2 medicines confirmed. The rest block the prescribing simulation. Penicillin allergy still needs confirming.");
  // Confirmed without an ingredient is not "all confirmed", exactly as the card reads it.
  expect(plain(leadFor("medication", amelia, { medicines: [med(true), med(true, { ingredient: " " })] }))).toMatch(/^2 of 2 medicines confirmed/);
  expect(plain(leadFor("medication", amelia, { medicines: [med(true), med(true), med(true)] }))).toMatch(/^All 3 medicines are confirmed\./);
});

test("the note lead names the real state and the step that changes it", () => {
  expect(leadFor("note", amelia, { note: "none" })).toBe("No note yet. Play the sample consultation, then draft the note from it.");
  expect(leadFor("note", amelia, { note: "draft" })).toMatch(/drafted from the transcript/);
  expect(leadFor("note", amelia, { note: "reviewed" })).toBe("The consultation note is marked reviewed.");
});

test("the X-ray lead only mentions a reference radiograph when the card shows one", () => {
  expect(leadFor("xray", amelia, { image: "reference" })).toMatch(/reference chest radiograph, not this patient’s/);
  for (const image of ["attached", "unsupported", "no-finding", "none"]) expect(leadFor("xray", amelia, { image })).not.toMatch(/reference/);
  expect(leadFor("xray", amelia, { image: "attached" })).toBe("Your image is attached. Nothing has been read from it, so there are no findings.");
  // Live mode, once the image model read it: says so, and that it is unvalidated; never "nothing has been read".
  expect(leadFor("xray", amelia, { image: "read" })).toMatch(/image model has described your image.*unvalidated/);
});

test("the evidence lead never contradicts 'not enough evidence', and is hidden while the card is still searching", () => {
  expect(leadFor("evidence", amelia, { evidence: "rehearsed" }, "")).toMatch(/against routine steroids/);
  expect(leadFor("evidence", amelia, { evidence: "not-enough" }, "Steroids?")).toBe("Not enough evidence was found to answer this, so Sona makes no claim.");
  expect(leadFor("evidence", amelia, { evidence: "enough" }, "Anything")).not.toMatch(/steroids/);
  expect(leadFor("evidence", amelia, { evidence: "off" }, "Anything")).toMatch(/Live mode/);
  expect(leadFor("evidence", amelia, {}, "Anything")).toBeUndefined();
});

test("the briefing lead mentions a result only while it waits to be acknowledged; prescribing and follow-up follow their state", () => {
  expect(leadFor("briefing", daniel, { result: { test: "Potassium" } })).toMatch(/most of the history is still missing\. A new potassium result needs acknowledging\.$/);
  expect(leadFor("briefing", daniel, {})).not.toMatch(/result/);
  expect(leadFor("prescription", amelia, { prescription: "created" })).toMatch(/created a receipt/);
  expect(leadFor("prescription", amelia, {})).toMatch(/^Nothing is prescribed yet/);
  expect(leadFor("followup", amelia, { tasks: { total: 2, open: 1 } })).toBe("1 follow-up is open for Amelia.");
  expect(leadFor("followup", amelia, { tasks: { total: 2, open: 0 } })).toBe("All of Amelia’s follow-ups are done.");
  expect(leadFor("followup", amelia, { tasks: { total: 0, open: 0 } })).toMatch(/^One follow-up is proposed/);
});
