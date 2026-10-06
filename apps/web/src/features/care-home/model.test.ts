// @ts-ignore -- apps/web has no Bun types installed; drop this line once @types/bun is a devDependency.
import { expect, test } from "bun:test";

import { dosesToday, langOf, nextStep } from "./model";

const now = new Date("2026-10-06T09:00:00+08:00");
const dose = (h: number, taken = false) => {
  const dueAt = new Date(now.getTime() + h * 3600_000);
  return { name: "Med", line: "1 tablet", dueAt, key: `Med@${dueAt.toISOString()}`, taken };
};

test("langOf maps the browser language", () => {
  expect([langOf("ms-MY"), langOf("zh-CN"), langOf("fr"), langOf(undefined)]).toEqual(["ms", "zh", "en", "en"]);
});

test("nextStep: dose due, then check-in, then visit", () => {
  const checkIn = { replies: [], sentAt: null, dueAt: new Date(now.getTime() - 1) };
  const visit = { title: "Clinic", date: now, inDays: 2 };
  expect(nextStep([dose(-1, true), dose(0.25)], [checkIn], [visit], now).kind).toBe("dose");
  expect(nextStep([dose(3)], [checkIn], [visit], now).kind).toBe("check-in");
  expect(nextStep([], [{ ...checkIn, replies: [1] }], [{ ...visit, inDays: -1 }, visit], now)).toEqual({ kind: "visit", visit });
  expect(nextStep([], [], [], now).kind).toBe("none");
});

test("dosesToday is empty before discharge", () => {
  expect(dosesToday([{ name: "Med", line: "x" }], undefined, [], now)).toEqual([]);
});
