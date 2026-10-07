// @ts-expect-error apps/web has no bun types yet (as in lib/wav.test.ts); add @types/bun and drop this line.
import { expect, test } from "bun:test";

import { daysAfter, offsetText, roleAreas } from "./rules";

test("a role's areas list only the rules that differ between roles", () => {
  const rules = {
    "ward.beds": [["doctor", "nurse", "bed-manager", "management"], "see the ward"],
    "ward.assignOwner": [["nurse", "bed-manager"], "assign a blocker owner"],
    "checkIns.reply": [["doctor"], "reply to a check-in"],
  } as const;
  expect(roleAreas("nurse", rules)).toEqual([
    { area: "Ward", can: ["assign a blocker owner"], cannot: [] },
    { area: "Check ins", can: [], cannot: ["reply to a check-in"] },
  ]);
});

test("days after discharge count calendar days in Kuala Lumpur", () => {
  // 23:30 in Kuala Lumpur on the 1st, then 00:30 on the 2nd: one hour later, the next day.
  expect(daysAfter(new Date("2026-10-01T15:30:00Z"), new Date("2026-10-01T16:30:00Z"))).toBe(1);
  expect(daysAfter(new Date("2026-10-01T02:00:00Z"), new Date("2026-10-01T09:00:00Z"))).toBe(0);
});

test("the clock's offset is said in plain words", () => {
  expect(offsetText(0)).toBe("on real time");
  expect(offsetText(3 * 3_600_000)).toBe("3 hours ahead of real time");
  expect(offsetText(-86_400_000)).toBe("1 day behind real time");
  expect(offsetText(7 * 86_400_000)).toBe("7 days ahead of real time");
  expect(offsetText(1_284 * 86_400_000)).toBe("1,284 days ahead of real time");
});
