import { expect, test } from "bun:test";
import { streak, streakLine } from "./streak";

// Cetirizine at 9:00 PM Malaysia (13:00Z), home since 10 AM on 24 Sep.
const meds = [{ name: "Cetirizine", line: "", at: ["21:00"] }];
const out = "2026-09-24T02:00:00Z";
const key = day => `Cetirizine@2026-09-${day}T13:00:00.000Z`;
const noon27 = new Date("2026-09-27T04:00:00Z");

test("the streak counts days in a row with every dose taken; today's dose still to come doesn't break it", () => {
  expect(streak(meds, out, [key(24), key(25), key(26)], noon27)).toBe(3);
  expect(streak(meds, out, [key(24), key(26)], noon27)).toBe(1);
  expect(streak(meds, out, [key(24), key(25)], noon27)).toBe(0);
  expect(streak(meds, undefined, [], noon27)).toBe(0);
});

test("a dose late but within 6 h neither counts nor breaks the streak", () => {
  expect(streak(meds, out, [key(24), key(25)], new Date("2026-09-26T15:00:00Z"))).toBe(2);
});

test("under two days reads as a start, not a streak of one", () => {
  expect(streakLine(0)).toBe("Day 1 · keep going");
  expect(streakLine(1)).toBe("Day 1 · keep going");
  expect(streakLine(5)).toBe("5 day streak 🔥");
});
