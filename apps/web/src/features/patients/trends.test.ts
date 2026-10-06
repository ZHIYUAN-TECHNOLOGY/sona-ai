// @ts-expect-error apps/web has no bun types yet (same as search.test.ts); add @types/bun and drop this line.
import { expect, test } from "bun:test";

import { allSeries, direction, topSeries } from "./trends";

const at = (d: number) => `2026-09-${String(d).padStart(2, "0")}T00:00:00Z`;

const all = allSeries({
  labs: [
    { test: "Sodium", unit: "mmol/L", points: [{ at: at(20), value: 140, flag: "normal" }] },
    { test: "Potassium", unit: "mmol/L", points: [{ at: at(5), value: 6.2, flag: "critical-high" }, { at: at(1), value: 4.1, flag: null }] },
    { test: "Empty", unit: null, points: [] },
  ],
  observations: [{ kind: "Weight", unit: "kg", points: [{ at: at(10), value: 70 }, { at: at(12), value: 70 }] }],
});

test("flagged latest lab first, then observations, then other labs; empty series dropped", () => {
  expect(topSeries(all).map(s => s.name)).toEqual(["Potassium", "Weight", "Sodium"]);
});

test("direction compares the latest value with the one before it by date", () => {
  const [potassium, weight, sodium] = topSeries(all);
  expect(direction(potassium!)).toBe("Up from 4.1");
  expect(direction(weight!)).toBe("Unchanged from 70");
  expect(direction(sodium!)).toBe("Only value on record");
});
