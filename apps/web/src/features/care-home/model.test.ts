// @ts-ignore -- apps/web has no Bun types installed; drop this line once @types/bun is a devDependency.
import { expect, test } from "bun:test";

import { dayLead, dosesToday, langOf, nextStep, partOfDay } from "./model";

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

test("the greeting follows the clock in Malaysia", () => {
  expect(partOfDay(new Date("2026-10-06T09:00:00+08:00"))).toBe("morning");
  expect(partOfDay(new Date("2026-10-06T12:00:00+08:00"))).toBe("afternoon");
  expect(partOfDay(new Date("2026-10-06T18:00:00+08:00"))).toBe("evening");
  expect(partOfDay(new Date("2026-10-06T00:30:00+08:00"))).toBe("morning");
});

test("dayLead says the day in one sentence", () => {
  expect(dayLead(2, 1, undefined, true)).toBe("2 doses left today and a check-in to answer.");
  expect(dayLead(1, 0, "tomorrow", true)).toBe("1 dose left today. Your next visit is tomorrow.");
  expect(dayLead(0, 0, "today at 2:34 pm", false)).toBe("Your next visit is today at 2:34 pm and there is nothing else to do.");
  expect(dayLead(0, 0, undefined, false)).toBe("You are still in hospital. Nothing needs you today.");
});
