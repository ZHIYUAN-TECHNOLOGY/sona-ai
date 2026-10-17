import { expect, test } from "bun:test";
import { loudness } from "../../features/live/turn";
import { follow, HISTORY, pushHistory } from "./veil-signal";

const run = (env, target, ms) => { for (let t = 0; t < ms; t += 16) env = follow(env, target, 16); return env; };

test("metering maps to 0..1 loudness", () => {
  expect(loudness(-160)).toBe(0);
  expect(loudness(-35)).toBe(0.5);
  expect(loudness(0)).toBe(1);
});

test("the envelope rises fast and falls slowly", () => {
  // One time constant reaches ~63%.
  expect(run(0, 1, 80)).toBeGreaterThan(0.6);
  expect(run(0, 1, 80)).toBeLessThan(0.75);
  expect(run(1, 0, 80)).toBeGreaterThan(0.75);
  expect(run(1, 0, 350)).toBeLessThan(0.4);
  expect(run(0, 1, 1000)).toBeCloseTo(1, 3);
  expect(follow(0.5, 0.5, 16)).toBe(0.5);
});

test("history keeps its length with the newest first", () => {
  const h = Array(HISTORY).fill(0);
  pushHistory(h, 0.3);
  pushHistory(h, 0.9);
  expect(h.length).toBe(HISTORY);
  expect(h.slice(0, 3)).toEqual([0.9, 0.3, 0]);
});
