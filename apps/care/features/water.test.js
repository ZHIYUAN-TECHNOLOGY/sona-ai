import { expect, mock, test } from "bun:test";

const saved = [];
mock.module("expo-secure-store", () => ({ getItemAsync: async () => null, setItemAsync: async (_k, v) => { saved.push(v); } }));
const { glassesOn, setGlasses, tapCup, waterDay } = await import("./water");

test("water counts per Malaysia day, so yesterday's glasses read as zero", () => {
  const late = new Date("2026-09-27T15:30:00Z"); // 11:30 PM Sun, Malaysia
  const log = { day: waterDay(late), glasses: 5 };
  expect(glassesOn(log, late)).toBe(5);
  expect(glassesOn(log, new Date("2026-09-27T16:30:00Z"))).toBe(0); // 12:30 AM Mon
});

test("a cup tap fills up to it, the last filled cup undoes one, and the count stays 0 to 8", () => {
  expect(tapCup(3, 3)).toBe(4); // the next cup adds a glass
  expect(tapCup(3, 5)).toBe(6); // a later cup logs several at once
  expect(tapCup(3, 2)).toBe(2); // the last filled cup takes one back
  expect(tapCup(3, 0)).toBe(1);
  expect(tapCup(8, 7)).toBe(7);
  expect(tapCup(0, 9)).toBe(8);
});

test("setting glasses saves today's day with the count, clamped", () => {
  const now = new Date("2026-09-28T02:00:00Z");
  setGlasses(11, now);
  expect(JSON.parse(saved.at(-1))).toEqual({ day: waterDay(now), glasses: 8 });
  setGlasses(-1, now);
  expect(JSON.parse(saved.at(-1)).glasses).toBe(0);
});
