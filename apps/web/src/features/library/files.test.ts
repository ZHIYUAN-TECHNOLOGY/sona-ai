// @ts-ignore -- apps/web has no Bun types installed; drop this line once @types/bun is a devDependency.
import { expect, test } from "bun:test";

import { boxStyle, isStale } from "./files";

test("boxes in thousandths and in fractions land on the same place", () => {
  const expected = { top: "29%", left: "26%", height: "10%", width: "8%" };
  const round = (s: Record<string, string>) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, `${Math.round(parseFloat(v))}%`]));
  expect(round(boxStyle([290, 260, 390, 340]))).toEqual(expected);
  expect(round(boxStyle([0.29, 0.26, 0.39, 0.34]))).toEqual(expected);
});

test("a box outside the image is clamped to it", () => {
  expect(boxStyle([-50, 900, 1200, 1100])).toEqual({ top: "0%", left: "90%", height: "100%", width: "10%" });
});

test("a source is stale from five years old", () => {
  expect(isStale(2021, 2026)).toBe(true);
  expect(isStale(2022, 2026)).toBe(false);
});
