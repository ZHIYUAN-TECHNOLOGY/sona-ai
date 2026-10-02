import { expect, test } from "bun:test";
import { exported, insight, leakLine, placeholderParts, redactedWords, removed, spoken, trainingLine } from "./model";

test("de-identified text splits into plain runs and placeholder chips, and reads aloud without brackets", () => {
  const text = "[LEAK] reports cough. [NAME] ([MRN]), call [PHONE].";
  expect(placeholderParts(text)).toEqual([
    { text: "[LEAK]", placeholder: "LEAK" }, { text: " reports cough. " }, { text: "[NAME]", placeholder: "NAME" }, { text: " (" },
    { text: "[MRN]", placeholder: "MRN" }, { text: "), call " }, { text: "[PHONE]", placeholder: "PHONE" }, { text: "." },
  ]);
  expect(placeholderParts("demam balik")).toEqual([{ text: "demam balik" }]);
  expect(placeholderParts("[X] and [name] stay plain")).toEqual([{ text: "[X] and [name] stay plain" }]);
  expect(spoken(text)).toBe("leaked identity masked reports cough. name removed (record number removed), call phone removed.");
});

test("the insight line, the leak line and the export receipt", () => {
  expect(insight({ contributes: true, counts: { pending: 3, blocked: 1 }, lastDataset: { version: 1, rows: 12 } })).toBe("3 waiting for review · 1 blocked · last dataset v1, 12 rows");
  expect(insight({ contributes: false, counts: { pending: 0, blocked: 0 }, lastDataset: null })).toBe("Sharing off · nothing waiting for review · no dataset yet");
  expect(leakLine(["name"])).toBe("Blocked by leak check · name found");
  expect(leakLine(["name", "ic"])).toBe("Blocked by leak check · name and IC found");
  expect(exported({ version: 2, rows: 1 })).toBe("v2 · 1 row · leak check passed");
  expect([trainingLine({ pending: 3, blocked: 1 }), trainingLine({ pending: 0, blocked: 2 }), trainingLine({ pending: 0, blocked: 0 })]).toEqual(["3 waiting · 1 blocked", "2 blocked", "Nothing to review"]);
});

test("each card says what was removed and by whom", () => {
  const found = [{ kind: "name" }, { kind: "phone" }, { kind: "name" }, { kind: "name" }, { kind: "name" }];
  // Each count names the placeholder it left, so the card can tint the count like its chips.
  expect(removed(found, "OpenMed/OpenMed-PII-mClinicalE5-Large-560M-v1")).toEqual({ who: "OpenMed", counts: [{ placeholder: "NAME", text: "4 names" }, { placeholder: "PHONE", text: "1 phone number" }] });
  expect(removed([{ kind: "ic" }], "rules")).toEqual({ who: "Rules", counts: [{ placeholder: "IC", text: "1 IC number" }] });
  expect(removed([], "rules")).toEqual({ who: "Rules", counts: [] });
});

test("redacted text lays out as words: a placeholder keeps its punctuation, and spaces are kept between words", () => {
  const flat = words => words.map(w => w.parts.map(p => p.placeholder ? `<${p.placeholder}>` : p.text).join("") + (w.space ? "_" : ""));
  expect(flat(redactedWords("[NAME]'s husband [NAME] heard it. Call [PHONE]."))).toEqual(["<NAME>'s_", "husband_", "<NAME>_", "heard_", "it._", "Call_", "<PHONE>."]);
  expect(flat(redactedWords("[NAME] ([MRN]): cough"))).toEqual(["<NAME>_", "(<MRN>):_", "cough"]);
  expect(flat(redactedWords("demam  balik "))).toEqual(["demam_", "balik_"]);
});
