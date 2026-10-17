import { expect, test } from "bun:test";

import { isWatch, lastDue, nextDue, parseWatch } from "./watch";

test("a spoken watch is read as its question and hour", () => {
  expect(parseWatch("Sona, every morning at 7, tell me which of my patients has potassium above 5.")).toEqual({ question: "Which of my patients has potassium above 5", hour: 7 });
  expect(parseWatch("Every evening at 6 show me tasks that are overdue")).toEqual({ question: "Tasks that are overdue", hour: 18 });
  expect(parseWatch("which results are not acknowledged, daily at 4pm")).toEqual({ question: "Which results are not acknowledged", hour: 16 });
  expect(parseWatch("every day at 12am let me know who has a critical result").hour).toBe(0);
  expect(parseWatch("every night, who is still waiting on a lab?")).toEqual({ question: "Who is still waiting on a lab?", hour: 21 });
  // No schedule said: every morning. A number in the question is not a time.
  expect(parseWatch("Who has potassium at 5 or more?")).toEqual({ question: "Who has potassium at 5 or more?", hour: 7 });
});

test("only a sentence that opens or closes with its schedule is a watch", () => {
  expect(isWatch("Sona, every morning at 7, tell me which of my patients has potassium above 5.")).toBe(true);
  expect(isWatch("which results are not acknowledged, daily at 4pm")).toBe(true);
  expect(isWatch("Does she take metformin every morning with food?")).toBe(false);
  expect(isWatch("Who has potassium at 5 or more?")).toBe(false);
  expect(isWatch("every morning at 7")).toBe(false);
});

test("a watch is due at its hour in Malaysia, once a day", () => {
  const now = new Date("2026-10-04T06:30:00+08:00");
  expect(lastDue(7, now).toISOString()).toBe(new Date("2026-10-03T07:00:00+08:00").toISOString());
  expect(nextDue(7, now).toISOString()).toBe(new Date("2026-10-04T07:00:00+08:00").toISOString());
  expect(lastDue(7, new Date("2026-10-04T07:00:00+08:00")).toISOString()).toBe(new Date("2026-10-04T07:00:00+08:00").toISOString());
  expect(lastDue(0, now).toISOString()).toBe(new Date("2026-10-04T00:00:00+08:00").toISOString());
});
