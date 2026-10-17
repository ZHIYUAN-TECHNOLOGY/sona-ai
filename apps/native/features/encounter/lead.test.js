import { expect, test } from "bun:test";
import { patients } from "./fixtures";
import { leadFor } from "./lead";

const amelia = patients.find(p => p.id === "SYN-1042");
const daniel = patients.find(p => p.id === "SYN-1086");
const med = (confirmed, over = {}) => ({ confirmed, ingredient: "Salbutamol", formulation: "Inhaler", ...over });
const plain = text => text?.replace(/\[\[([^|]+)\|\w+\]\]/g, "$1");

test("the medication lead counts what the card counts, and never says 'nothing cleared' above 'all confirmed'", () => {
  expect(plain(leadFor("medication", amelia, { medicines: [med(true), med(true)] }))).toBe("Both medicines are confirmed. Penicillin allergy still needs confirming.");
  expect(plain(leadFor("medication", amelia, { medicines: [med(true), med(false)] }))).toBe("1 medicine to confirm before prescribing. Penicillin allergy still needs confirming.");
  expect(plain(leadFor("medication", amelia, { medicines: [med(false), med(false)] }))).toMatch(/^2 medicines to confirm before prescribing\./);
  // Confirmed without an ingredient still needs confirming, exactly as the card reads it.
  expect(plain(leadFor("medication", amelia, { medicines: [med(true), med(true, { ingredient: " " })] }))).toMatch(/^1 medicine to confirm before prescribing\./);
  expect(plain(leadFor("medication", amelia, { medicines: [med(true), med(true), med(true)] }))).toMatch(/^All 3 medicines are confirmed\./);
});

test("once a clinician records the allergy, the medication lead stops asking for it", () => {
  expect(plain(leadFor("medication", amelia, { medicines: [med(true), med(false)], allergyConfirmed: true }))).toBe("1 medicine to confirm before prescribing.");
  expect(leadFor("medication", daniel, { medicines: [], allergyConfirmed: true })).toBe("No medicines are recorded yet.");
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
  // While the image is being saved or read there is no lead (the card says which): "nothing has been read" is not said a moment before the reading.
  expect(leadFor("xray", amelia, { image: "reading" })).toBeUndefined();
});

test("the briefing lead keeps the recorded condition's acronyms: only an ordinary first word loses its capital", () => {
  const here = subtitle => plain(leadFor("briefing", { ...amelia, subtitle }, {})).match(/here for a ([^.]+)\./)[1];
  expect(here("COPD exacerbation")).toBe("COPD exacerbation");
  expect(here("Upper GI bleed")).toBe("upper GI bleed");
  expect(here("NSTEMI, day 2")).toBe("NSTEMI, day 2");
  expect(here("Respiratory review")).toBe("respiratory review");
});

test("the evidence lead never contradicts 'not enough evidence', and is hidden while the card is still searching", () => {
  expect(leadFor("evidence", amelia, { evidence: "rehearsed" }, "")).toMatch(/against routine steroids/);
  expect(leadFor("evidence", amelia, { evidence: "not-enough" }, "Steroids?")).toBe("Not enough evidence was found to answer this.");
  expect(leadFor("evidence", amelia, { evidence: "general" }, "Anything")).toMatch(/general answer, not from the evidence/);
  expect(leadFor("evidence", amelia, { evidence: "enough" }, "Anything")).not.toMatch(/steroids/);
  expect(leadFor("evidence", amelia, { evidence: "off" }, "Anything")).toMatch(/Live mode/);
  expect(leadFor("evidence", amelia, {}, "Anything")).toBeUndefined();
  // An answer's own bottom line leads, so the doctor reads the answer before the card.
  expect(leadFor("evidence", amelia, { evidence: "enough", bottomLine: "Not routinely." }, "Steroids?")).toBe("Not routinely.");
});

test("the briefing lead mentions a result only while it waits to be acknowledged; prescribing and follow-up follow their state", () => {
  expect(leadFor("briefing", daniel, { result: { test: "Potassium" } })).toMatch(/most of the history is still missing\. A new potassium result needs acknowledging\.$/);
  expect(leadFor("briefing", daniel, {})).not.toMatch(/result/);
  // A receipt is said by where it was written: the visit record when connected, else a sample on this phone. Never "simulation".
  expect(leadFor("prescription", amelia, { prescription: "created", live: true })).toBe("Every check passed. Prescription recorded, in the visit record, not sent to a pharmacy.");
  expect(leadFor("prescription", amelia, { prescription: "created" })).toMatch(/^Every check passed\. Sample prescription, on this phone only/);
  for (const prescription of ["created", "failed", "outside", "ready", undefined]) expect(leadFor("prescription", amelia, { prescription, live: true })).not.toMatch(/simulat/i);
  expect(leadFor("prescription", amelia, {})).toMatch(/^Nothing is prescribed yet/);
  expect(leadFor("followup", amelia, { tasks: { total: 2, open: 1 } })).toBe("1 follow-up is open for Amelia.");
  expect(leadFor("followup", amelia, { tasks: { total: 2, open: 0 } })).toBe("All of Amelia’s follow-ups are done.");
  expect(leadFor("followup", amelia, { tasks: { total: 0, open: 0 } })).toMatch(/^One follow-up is proposed/);
});
