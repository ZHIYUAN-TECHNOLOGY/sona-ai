// @ts-ignore -- apps/web has no Bun types installed; drop this line once @types/bun is a devDependency.
import { expect, test } from "bun:test";

import { bandXs, linePath, pointXs, scale, yDomain } from "./chart-scale";

test("yDomain handles empty, single and flat series", () => {
  expect(yDomain([])).toEqual([0, 1]);
  expect(yDomain([5])).toEqual([4, 6]);
  expect(yDomain([3, 3, 3])).toEqual([2, 4]);
  expect(yDomain([2, -1, 7])).toEqual([-1, 7]);
});

test("scale maps the domain onto an inverted pixel range", () => {
  const y = scale([0, 10], [100, 0]);
  expect(y(0)).toBe(100);
  expect(y(10)).toBe(0);
  expect(y(2.5)).toBe(75);
});

test("pointXs spreads edge to edge and centres one point", () => {
  expect(pointXs(0, 0, 100)).toEqual([]);
  expect(pointXs(1, 0, 100)).toEqual([50]);
  expect(pointXs(3, 0, 100)).toEqual([0, 50, 100]);
});

test("bandXs centres each bar in its band", () => {
  expect(bandXs(0, 0, 100)).toEqual([]);
  expect(bandXs(2, 0, 100)).toEqual([25, 75]);
});

test("linePath builds a move then lines", () => {
  expect(linePath([], [])).toBe("");
  expect(linePath([50], [10])).toBe("M50 10");
  expect(linePath([0, 50], [10, 20])).toBe("M0 10 L50 20");
});
