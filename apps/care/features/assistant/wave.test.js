import { expect, test } from "bun:test";
import { bar, clock } from "./wave";

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
