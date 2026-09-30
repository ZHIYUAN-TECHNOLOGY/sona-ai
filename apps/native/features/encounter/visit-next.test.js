import { expect, test } from "bun:test";
import { threadEnd } from "./visit-next";

const confirm = { tone: "caution", text: "2 medicines to confirm", action: "Confirm", target: "medication" };
const base = { latest: "briefing", hasSteps: false, firstName: "Amelia", discharged: false, follow: ["reasoning", "xray", "medication"] };

test("the visit's own need leads, and the questions never repeat it or the answer just given", () => {
  expect(threadEnd({ ...base, need: confirm })).toEqual({ need: confirm, ask: ["reasoning", "xray"] });
  expect(threadEnd({ ...base, latest: "reasoning", need: confirm, follow: ["evidence", "reasoning", "medication"] }).ask).toEqual(["evidence"]);
});

test("the floating bar owns the step during medicines and prescribing; evidence adds no questions", () => {
  expect(threadEnd({ ...base, latest: "medication", need: confirm, hasSteps: true, follow: ["prescription", "reasoning", "note"] })).toEqual({ need: undefined, ask: ["prescription", "reasoning"] });
  expect(threadEnd({ ...base, latest: "evidence", need: confirm, follow: ["prescription", "note"] }).ask).toEqual([]);
});

test("with nothing left the step is handing over, worded for a discharged patient", () => {
  expect(threadEnd({ ...base }).need).toMatchObject({ action: "Hand over", target: "handover", text: "Nothing else needs Amelia now" });
  expect(threadEnd({ ...base, discharged: true }).need?.text).toBe("Amelia is discharged · hand over when you’re done");
});

test("a need the answer just shown already meets is left to that answer: no looping Brief me under the briefing", () => {
  const result = { tone: "urgent", text: "New result to review", action: "Brief me", target: "briefing" };
  const end = threadEnd({ ...base, latest: "briefing", need: result, follow: ["briefing", "reasoning", "xray"] });
  expect(end.need).toBeUndefined();
  expect(end.ask).toEqual(["reasoning", "xray"]);
  expect(threadEnd({ ...base, latest: "reasoning", need: result }).need).toBe(result);
});
