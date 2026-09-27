import { expect, test } from "bun:test";
import { daysHome, needsLine, whereWords } from "./home";

test("days at home count calendar days in Malaysia, from the discharge day", () => {
  expect(daysHome("2026-09-26T15:30:00Z", new Date("2026-09-26T16:30:00Z"))).toBe(1); // 23:30 → 00:30 +08:00 is the next day
  expect(daysHome("2026-09-26T02:00:00Z", new Date("2026-09-28T01:00:00Z"))).toBe(2);
  expect(daysHome(undefined)).toBeUndefined();
});

test("the title says where you are, the line how much needs you", () => {
  expect(whereWords(2)).toEqual(["Day 2", " at home"]);
  expect(whereWords(0)).toEqual(["Home", " today"]);
  expect(whereWords(undefined)).toEqual(["Your care", " between visits"]);
  expect(needsLine(1)).toBe("1 thing needs you");
  expect(needsLine(2)).toBe("2 things need you");
  expect(needsLine(0)).toBe("Nothing needs you today");
});
