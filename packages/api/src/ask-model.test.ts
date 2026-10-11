import { expect, test } from "bun:test";

import { freeAnswer, lifted, untagged } from "./ask-model";
import { boxState } from "./baseten-models";

test("Gemma's misplaced general and children are put back, so its answer is used (10 Oct, staging: \"Who needs me first?\")", () => {
  const raw = { root: "f", elements: { f: { type: "AskColumn", props: {}, children: ["f-0", "f-1"] }, "f-0": { type: "AskLead", props: { text: "Daniel first." }, children: [] }, "f-1": { type: "AskRows", props: { rows: [], children: [] } }, general: "Check his ECG." } };
  expect(lifted(raw)).toEqual({ root: "f", elements: { f: raw.elements.f, "f-0": raw.elements["f-0"], "f-1": { type: "AskRows", props: { rows: [] }, children: [] } }, general: "Check his ECG.", evidence: undefined });
  const fine = { root: "f", elements: { f: { type: "AskColumn", props: {}, children: [] } }, general: "x" };
  expect(lifted(fine).elements).toEqual(fine.elements);
});

test("kind tags Gemma writes into its words are taken out; the colours come from its marks", () => {
  const lead = (text: string) => (lifted({ root: "f", elements: { "f-0": { type: "AskLead", props: { text }, children: [] } } }) as any).elements["f-0"].props.text;
  expect(lead('Treat <finding>pyelonephritis</finding> with <mark kind="medicine">ceftriaxone</mark>.')).toBe("Treat pyelonephritis with ceftriaxone.");
});

test("any markup Gemma writes into its words goes and the words stay (10 Oct, gate: \"a low  of .\" on \"What needs me first?\")", () => {
  expect(untagged('a low <mark text="potassium" kind="alert"/> of <mark text="3.1 mmol/L" kind="alert"/>.')).toBe("a low potassium of 3.1 mmol/L.");
  expect(untagged('<mark text="ECG" kind="caution">ECG</mark> and <mark text="hypokalaemia" kind="finding"</mark>, <allergy>penicillin</allergy> allergy')).toBe("ECG and hypokalaemia, penicillin allergy");
  expect(untagged("<br>Reconcile <medications> on admission; <symptom>cough<symptom> and <salbutamol</medicine> is a <drug allergy>")).toBe("Reconcile medications on admission; cough and salbutamol is a drug allergy");
  expect(untagged("Replace if K <3.5 or K < 3.0 mmol/L.")).toBe("Replace if K <3.5 or K < 3.0 mmol/L."); // a "<" before a number is not a tag
  // An apostrophe in the marked words, and an "=" after an unclosed fragment, keep every word (10 Oct, review).
  expect(untagged('Her <mark text="Crohn\'s disease" kind="finding"/> is quiet; <mark text="the patient\'s potassium of 3.1" kind="alert"/> is low.')).toBe("Her Crohn's disease is quiet; the patient's potassium of 3.1 is low.");
  expect(untagged("There are no <allergy recorded; CURB-65 = 0.")).toBe("There are no allergy recorded; CURB-65 = 0.");
});

test("a column that is not one of leaves is put back as one: rows listed under the lead, an id under itself, a child never written", () => {
  const lead = { type: "AskLead", props: { text: "Her Hb is 9.8 g/dL." }, children: ["f-1", "f-0"] }, rows = { type: "AskRows", props: { rows: [] }, children: [] };
  expect(lifted({ root: "f", elements: { f: { type: "AskColumn", props: {}, children: ["f-0", "f-9"] }, "f-0": lead, "f-1": rows } }).elements)
    .toEqual({ f: { type: "AskColumn", props: {}, children: ["f-0", "f-1"] }, "f-0": { ...lead, children: [] }, "f-1": rows });
  // A page with no rows to copy (a visit's record): rows written from its lines are left out, and the lead stays.
  expect(lifted({ root: "f", elements: { f: { type: "AskColumn", props: {}, children: ["f-0", "f-1"] }, "f-0": lead, "f-1": rows } }, false).elements)
    .toEqual({ f: { type: "AskColumn", props: {}, children: ["f-0"] }, "f-0": { ...lead, children: [] } });
});

test("a free answer's marks come in the shared kinds, grouped or as the old list, only for words in what the clinician reads", async () => {
  const general = "Hypokalaemia can cause arrhythmias; give oral potassium and recheck the potassium in 24 hours.";
  const ask = async (marks: unknown) => {
    boxState.clear();
    const fetcher = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ general, marks }) } }] }))) as unknown as typeof fetch;
    return (await freeAnswer({ apiKey: "k", fetcher }, { scope: "today", question: "Low K, what to do?", context: { lines: [], rows: [] } }) as { marks?: unknown }).marks;
  };
  expect(await ask({ condition: ["Hypokalaemia"], warning: ["arrhythmias"], medicine: ["oral potassium"], dose: ["in 24 hours"], test: ["potassium"], symptom: ["chest pain"] })).toEqual([
    { text: "Hypokalaemia", kind: "condition" }, { text: "arrhythmias", kind: "warning" }, { text: "oral potassium", kind: "medicine" }, { text: "potassium", kind: "test" }, { text: "in 24 hours", kind: "dose" },
  ]);
  expect(await ask([{ text: "Hypokalaemia", kind: "finding" }, { text: "arrhythmias", kind: "alert" }])).toEqual([{ text: "Hypokalaemia", kind: "condition" }, { text: "arrhythmias", kind: "warning" }]);
  expect(await ask(undefined)).toBeUndefined();
});
