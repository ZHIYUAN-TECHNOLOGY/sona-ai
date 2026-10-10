import { expect, test } from "bun:test";

import { lifted } from "./ask-model";

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
