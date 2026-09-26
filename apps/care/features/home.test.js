import { expect, test } from "bun:test";
import { daysHome, insightLine } from "./home";

test("days at home count calendar days in Malaysia, from the discharge day", () => {
  expect(daysHome("2026-09-26T15:30:00Z", new Date("2026-09-26T16:30:00Z"))).toBe(1); // 23:30 → 00:30 +08:00 is the next day
  expect(daysHome("2026-09-26T02:00:00Z", new Date("2026-09-28T01:00:00Z"))).toBe(2);
  expect(daysHome(undefined)).toBeUndefined();
});

test("the insight line says where you are and how much needs you", () => {
  expect(insightLine(2, 1)).toBe("Day 2 at home · 1 thing needs you");
  expect(insightLine(0, 0)).toBe("Home today · nothing needs you today");
  expect(insightLine(undefined, 2)).toBe("Your care, between visits · 2 things need you");
});
