// @ts-expect-error apps/web has no bun types yet (as in lib/wav.test.ts); add @types/bun and drop this line.
import { expect, test } from "bun:test";

import { daysAfter, roleAreas } from "./rules";

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
