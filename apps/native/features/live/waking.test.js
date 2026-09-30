import { expect, jest, test } from "bun:test";
import { askUntilAwake, retryIn, startingLabel, startingReply, wakingOf } from "./waking";

test("only a sample with whole minutes to wait is a model starting", () => {
  expect(wakingOf({ source: "fixture", waking: 3, lines: [] })).toBe(3);
  expect(wakingOf({ source: "fixture" })).toBeUndefined();
  expect(wakingOf({ source: "model", model: "gemma", waking: 3 })).toBeUndefined();
  expect(wakingOf({ source: "fixture", waking: 0 })).toBeUndefined();
  expect(wakingOf(undefined)).toBeUndefined();
});

test("the starting line says about how long, a minute in words", () => {
  expect(startingLabel(3)).toBe("Sample for now · Sona's model is starting, about 3 min");
  expect(startingLabel(1)).toBe("Sample for now · Sona's model is starting, about a minute");
  expect(startingLabel(12, true)).toBe("Rule-based for now · Sona's model is starting, about 12 min");
  expect(startingReply(4)).toBe("Sona's model is starting, about 4 min. Ask again then.");
});

test("asks again every 45 s for up to 45 min", () => {
  expect(retryIn(0)).toBe(45_000);
  expect(retryIn(44 * 60_000 + 15_000)).toBe(45_000); // the last ask again lands at 45 min
  expect(retryIn(44 * 60_000 + 15_001)).toBeUndefined();
});

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test("a sample from a starting model is asked again until the model answers; a failed ask again keeps the sample", async () => {
  jest.useFakeTimers();
  const replies = [() => ({ source: "fixture", waking: 3 }), () => { throw new Error("offline"); }, () => ({ source: "fixture", waking: 1 }), () => ({ source: "model", model: "gemma" })];
  const shown = [], errors = [];
  let asks = 0;
  askUntilAwake(async () => replies[asks++](), a => shown.push(a), e => errors.push(e));
  await flush();
  expect(shown).toEqual([{ source: "fixture", waking: 3 }]);
  for (const _ of [1, 2, 3]) { jest.advanceTimersByTime(45_000); await flush(); }
  expect(asks).toBe(4);
  expect(errors).toEqual([]);
  expect(shown.map(a => a.waking ?? a.model)).toEqual([3, 1, "gemma"]);
  jest.advanceTimersByTime(10 * 45_000); await flush();
  expect(asks).toBe(4); // the model answered: no more asks
  jest.useRealTimers();
});

test("a failed first ask is an error, a plain sample is not asked again, and closing stops the asking", async () => {
  jest.useFakeTimers();
  const errors = [];
  askUntilAwake(async () => { throw new Error("down"); }, () => {}, e => errors.push(e.message));
  let plain = 0, starting = 0;
  askUntilAwake(async () => { plain++; return { source: "fixture" }; }, () => {}, () => {});
  const stop = askUntilAwake(async () => { starting++; return { source: "fixture", waking: 2 }; }, () => {}, () => {});
  await flush();
  stop();
  jest.advanceTimersByTime(5 * 45_000); await flush();
  expect(errors).toEqual(["down"]);
  expect([plain, starting]).toEqual([1, 1]);
  jest.useRealTimers();
});
