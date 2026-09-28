import { expect, test } from "bun:test";

import { deidentifyByRules, leakGate } from "./training";

const amelia = { names: ["Amelia Tan"], ic: "840312-14-5528", phone: "+60 11-0000 0000", mrn: "SYN-1042" };

test("the rules replace the full name, the IC (with or without dashes, valid dates only), phones, emails and the MRN", () => {
  const { text, replacements } = deidentifyByRules(
    "AMELIA TAN (SYN-1042), IC 840312-14-5528 / 840312145528, call 011-0000 0000 or +60123456789, amelia@mail.test. Order 991399-00-0000.",
    amelia,
  );
  expect(text).toBe("[NAME] ([MRN]), IC [IC] / [IC], call [PHONE] or [PHONE], [EMAIL]. Order 991399-00-0000.");
  expect(replacements.map(r => r.kind)).toEqual(["name", "mrn", "email", "ic", "ic", "phone", "phone"]);
  expect(replacements[0]).toEqual({ kind: "name", placeholder: "[NAME]" });
});

test("a first name alone slips past the rules, and the gate catches it (kinds only, value masked)", () => {
  const draft = deidentifyByRules("Amelia reports cough for five days. Amelia Tan's mother has asthma.", amelia);
  expect(draft.text).toBe("Amelia reports cough for five days. [NAME]'s mother has asthma.");
  expect(leakGate(draft.text, amelia)).toEqual({ kinds: ["name"], masked: "[LEAK] reports cough for five days. [NAME]'s mother has asthma." });
});

test("the gate passes clean text and finds the patient's own digits in any spacing, plus any IC or phone at all", () => {
  expect(leakGate("[NAME] reports fever returned. Tangent lines are not names.", amelia).kinds).toEqual([]);
  expect(leakGate("ic 840312145528, phone 0110000 0000", amelia).kinds.sort()).toEqual(["ic", "phone"]);
  expect(leakGate("Seen as syn-1042", amelia).kinds).toEqual(["mrn"]);
  expect(leakGate("Another person's IC 900101-10-1234 and 012 345 6789", { names: [] }).kinds.sort()).toEqual(["ic", "phone"]);
  expect(leakGate("reach me at a@b.co", { names: [] }).kinds).toEqual(["email"]);
  // Two-letter name tokens are not scanned (too many false alarms); three and up are.
  expect(leakGate("Ng was here; Lim too", { names: ["Ng Lim"] }).kinds).toEqual(["name"]);
});
