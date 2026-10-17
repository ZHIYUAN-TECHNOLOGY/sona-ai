// @ts-expect-error apps/web has no bun types yet (no new dependencies in this change); add @types/bun and drop this line.
import { expect, test } from "bun:test";

import { dosesToday, langOf, nextDose, partOf, weekDots, weekTaken } from "./model";

const meds = [{ name: "Amoxicillin", line: "500 mg", take: "1 capsule", at: ["08:00", "20:00"] }];
const out = "2026-10-01T04:00:00.000Z"; // noon in Malaysia
const now = new Date("2026-10-03T02:00:00.000Z"); // 10:00 in Malaysia
const morning = "Amoxicillin@2026-10-03T00:00:00.000Z";

test("today, next dose and the week follow the plan and what was taken", () => {
  expect(dosesToday(meds, out, [], now).map(d => d.key)).toEqual([morning, "Amoxicillin@2026-10-03T12:00:00.000Z"]);
  expect(nextDose(meds, out, [], now)?.key).toBe(morning);
  expect(nextDose(meds, out, [morning], now)?.key).toBe("Amoxicillin@2026-10-03T12:00:00.000Z");
  const week = weekTaken(meds, out, [morning], now, "en");
  expect(week).toHaveLength(7);
  expect(week.at(-1)).toMatchObject({ y: 1, due: 1 });
  expect(partOf(new Date(morning.split("@")[1]!))).toBe("Morning");
  expect([langOf("ms-MY"), langOf("zh-Hans"), langOf("fr"), langOf(undefined)]).toEqual(["ms", "zh", "en", "en"]);
});

test("weekDots marks each dose done, missed or upcoming", () => {
  const days = weekDots(meds, out, [], now, "en");
  expect(days.length).toBe(7);
  expect(days[6]!.dots.map(d => d.state)).toEqual(["upcoming", "upcoming"]);
  expect(days[5]!.dots.map(d => d.state)).toEqual(["missed", "missed"]);
});

test("a medicine taken for a year reads only the days it shows: same doses, without rebuilding every one since discharge", () => {
  const long = Array.from({ length: 18 }, (_, i) => ({ name: `Med ${i}`, line: "x", at: ["08:00", "12:00", "18:00", "22:00"] }));
  const yearAgo = new Date(now.getTime() - 400 * 86_400_000).toISOString();
  const started = performance.now();
  const today = dosesToday(long, yearAgo, [], now), next = nextDose(long, yearAgo, [], now), week = weekDots(long, yearAgo, [], now, "en");
  expect(performance.now() - started).toBeLessThan(40);
  expect(today).toHaveLength(72);
  expect(next?.key).toBe("Med 0@2026-10-03T00:00:00.000Z");
  expect(week.map(d => d.dots.length)).toEqual([72, 72, 72, 72, 72, 72, 72]);
});
