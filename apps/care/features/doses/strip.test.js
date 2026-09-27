import { expect, test } from "bun:test";
import { foodOf, strip } from "./strip";

const dose = (name, iso, taken = false) => ({ name, line: "", dueAt: new Date(iso), key: `${name}@${iso}`, taken });

test("the strip groups doses by time and state; the current one is ink, taken ones ticked", () => {
  const doses = [dose("Aspirin", "2026-09-27T00:00:00Z", true), dose("Metformin", "2026-09-27T00:00:00Z", true), dose("Amlodipine", "2026-09-27T12:00:00Z"), dose("Metformin", "2026-09-27T12:00:00Z"), dose("Cetirizine", "2026-09-27T13:30:00Z")];
  expect(strip(doses, "Amlodipine@2026-09-27T12:00:00Z").map(c => [c.state, c.label])).toEqual([
    ["did", "✓ 8 AM · Aspirin, Metformin"],
    ["now", "8 PM · Amlodipine"],
    ["later", "8 PM · Metformin"],
    ["later", "9:30 PM · Cetirizine"],
  ]);
});

test("food timing only when the take line names before or after", () => {
  expect(foodOf("1 tablet after food")).toBe("after");
  expect(foodOf("Take before meals")).toBe("before");
  expect(foodOf("1 tablet, with or without food")).toBeUndefined();
  expect(foodOf("1 tablet at night")).toBeUndefined();
});
