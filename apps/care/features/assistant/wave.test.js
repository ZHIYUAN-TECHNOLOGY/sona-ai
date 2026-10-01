import { expect, test } from "bun:test";
import { bar, clock, pieces } from "./wave";

test("loudness maps to a bar between a resting tick and full height", () => {
  expect(bar(-160)).toBe(0.12); // no metering yet
  expect(bar(-55)).toBe(0.12);
  expect(bar(-32.5)).toBeCloseTo(0.5);
  expect(bar(-10)).toBe(1);
  expect(bar(0)).toBe(1);
});

test("the timer reads m:ss", () => {
  expect(clock(0)).toBe("0:00");
  expect(clock(7_900)).toBe("0:07");
  expect(clock(62_000)).toBe("1:02");
});

test("live words split into pieces that keep their keys while the partial's start holds", () => {
  const before = pieces("I took my pills");
  expect(before.map(p => p.word + (p.space ? " " : "")).join("")).toBe("I took my pills");
  const after = pieces("I took my pills late");
  expect(after.slice(0, 4).map(p => p.key)).toEqual(before.map(p => p.key));
  expect(after.at(-1).key).toBe("4:late");
  expect(pieces("I took mine").at(-1).key).toBe("2:mine");
  expect(pieces("我忘了吃药 today").map(p => p.word)).toEqual(["我", "忘", "了", "吃", "药", "today"]);
  expect(pieces("吃药 today")[1].space).toBe(true);
  expect(pieces("  ")).toEqual([]);
});
