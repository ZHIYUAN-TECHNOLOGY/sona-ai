// @ts-ignore -- apps/web has no Bun types installed; drop this line once @types/bun is a devDependency.
import { expect, test } from "bun:test";

import { refusal, toLines, toRows } from "./visit";

test("toRows keeps the four sections in order and never drops another saved sentence", () => {
  const rows = toRows([{ id: "s9", text: "Addendum" }, { id: "plan", text: "Rest" }]);
  expect(rows.map(r => r.id)).toEqual(["subjective", "objective", "assessment", "plan", "s9"]);
  expect(rows[3]!.text).toBe("Rest");
  expect(rows[4]!.text).toBe("Addendum");
});

test("toLines reads speakers and skips blank lines", () => {
  expect(toLines("Doctor: How are you?\n\nPt: Sore throat\nthree days")).toEqual([
    { text: "How are you?", speaker: "clinician" }, { text: "Sore throat", speaker: "patient" }, { text: "three days" },
  ]);
});

test("refusal keeps the server's open checks", () => {
  expect(refusal({ message: "The prescription is blocked", data: { open: ["Weight"] } })).toEqual({ message: "The prescription is blocked", open: ["Weight"] });
});
