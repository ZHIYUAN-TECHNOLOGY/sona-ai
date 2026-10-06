// @ts-expect-error apps/web has no bun types yet (no new dependencies in this change); add @types/bun and drop this line.
import { expect, test } from "bun:test";

import { addDays, dateKey, hourOf, timeOf, weekOf } from "./time";

test("the hospital's day starts at +08:00", () => {
  const lateUtc = new Date("2026-10-05T17:30:00Z"); // 01:30 on the 6th in Malaysia
  expect(dateKey(lateUtc)).toBe("2026-10-06");
  expect(timeOf(lateUtc)).toBe("01:30");
  expect(hourOf(lateUtc)).toBe(1);
});

test("a week runs Monday to Sunday", () => {
  expect(weekOf("2026-10-06")).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
  expect(weekOf("2026-10-11")[0]).toBe("2026-10-05"); // Sunday belongs to the week before it ends
  expect(weekOf("2026-10-12")[0]).toBe("2026-10-12");
  expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
});
