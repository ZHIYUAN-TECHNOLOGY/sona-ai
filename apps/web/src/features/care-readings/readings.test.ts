// @ts-expect-error apps/web has no bun types yet (no new dependencies in this change); add @types/bun and drop this line.
import { expect, test } from "bun:test";

import { changeWords, parseReading, rangeWords, since, withReading, type ReadingList } from "./readings";

test("parseReading wants a number, and two for blood pressure", () => {
  expect(parseReading("weight", "70,5", "", "")).toEqual({ input: { kind: "weight", value: 70.5 } });
  expect(parseReading("weight", "abc", "", "")).toHaveProperty("error");
  expect(parseReading("blood_pressure", "120", "", "")).toHaveProperty("error");
  expect(parseReading("blood_pressure", "120", "80", "")).toEqual({ input: { kind: "blood_pressure", value: 120, value2: 80 } });
});

test("withReading adds to a series, or starts one, without touching the original", () => {
  const now = new Date("2026-10-06T08:00:00Z");
  const list: ReadingList = { days: 90, series: [{ kind: "weight", label: "Weight", unit: "kg", points: [{ id: "a", at: new Date("2026-10-05T08:00:00Z"), value: 70 }] }] };
  const more = withReading(list, { kind: "weight", value: 71 }, "t", now);
  expect(more.series[0]!.points.map(p => p.value)).toEqual([70, 71]);
  expect(list.series[0]!.points).toHaveLength(1);
  const bp = withReading(more, { kind: "blood_pressure", value: 120, value2: 80 }, "u", now);
  expect(bp.series.map(s => s.kind)).toEqual(["blood_pressure", "weight"]);
  expect(since(bp.series, +now).map(s => s.kind)).toEqual(["blood_pressure", "weight"]);
  expect(since(bp.series, +now + 1)).toEqual([]);
});

test("changeWords and rangeWords speak only from the numbers", () => {
  const pts = [72, 68, 77].map((value, i) => ({ id: `${i}`, at: new Date(i), value })) as never;
  expect(changeWords(pts)).toBe("up 9 since");
  expect(changeWords([] as never)).toBeUndefined();
  expect(rangeWords({ kind: "heart_rate", label: "Heart rate", unit: "bpm" }, pts)).toBe("Your heart rate stayed between 68 and 77 bpm.");
  expect("error" in parseReading("heart_rate", "0", "", "")).toBe(true);
});
