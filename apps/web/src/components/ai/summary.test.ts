// @ts-expect-error apps/web has no bun types yet; add @types/bun and drop this line
import { expect, test } from "bun:test";

import { ruleHeading, sourceKinds, stepsLine, stepsSummary } from "./summary";

test("steps mark what is done, under way and still to come", () => {
  expect(stepsLine("read", 7).map(s => `${s.label}:${s.state}`)).toEqual(["Searching the library:done", "Reading 7 sources:current", "Writing:next"]);
  expect(stepsLine("search").map(s => s.state)).toEqual(["current", "next", "next"]);
  expect(stepsLine("done", 1).map(s => s.state)).toEqual(["done", "done", "done"]);
  expect(stepsLine("done", 1)[1]!.label).toBe("Reading 1 source");
});

test("a finished answer folds into one line", () => {
  expect(stepsSummary(7, 4.04)).toBe("Read 7 sources in 4 s");
  expect(stepsSummary(1, 12.6)).toBe("Read 1 source in 13 s");
  expect(stepsSummary(0, 0.01)).toBe("Answered in 0.1 s");
  expect(stepsSummary(3)).toBe("Read 3 sources");
});

test("source kinds come once each, in a fixed order", () => {
  expect(sourceKinds([{ kind: "image" }, { kind: "study" }, { kind: "study" }])).toEqual(["study", "image"]);
  expect(sourceKinds([])).toEqual([]);
});

test("a rule answer counts only what needs the clinician", () => {
  const rows = [{ tone: "urgent" as const }, { tone: "soon" as const }, { tone: "good" as const }];
  expect(ruleHeading(rows, ["patient", "patients"])).toBe("2 patients need you");
  expect(ruleHeading(rows.slice(1), ["patient", "patients"])).toBe("1 patient needs you");
  expect(ruleHeading([{ tone: "calm" }])).toBe("Nothing needs you");
});
