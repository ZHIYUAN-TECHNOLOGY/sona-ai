import { expect, test } from "bun:test";

import { adherence, doseKey, missedLine, parseDoseKey } from "./doses";

const meds = [{ name: "Azithromycin", line: "", at: ["08:00"], doses: 3 }, { name: "Cetirizine", line: "", at: ["21:00"] }];
const out = "2026-09-26T07:40:00.000Z"; // Sat 26 Sep 15:40 in Kuala Lumpur

test("two days after discharge: the day-1 azithromycin not taken is missed, today's is only late", () => {
  const now = new Date("2026-09-28T10:01:00+08:00");
  const sat = doseKey("Cetirizine", new Date("2026-09-26T21:00:00+08:00")), sun = doseKey("Cetirizine", new Date("2026-09-27T21:00:00+08:00"));
  const a = adherence(meds, out, [sat, sun], now);
  expect([a.due, a.taken]).toEqual([4, 2]);
  expect(a.missed.map(m => [m.name, m.dueAt.toISOString()])).toEqual([["Azithromycin", new Date("2026-09-27T08:00:00+08:00").toISOString()]]);
  expect(a.late.map(m => m.name)).toEqual(["Azithromycin"]);
  expect(missedLine(a)).toBe("1 Azithromycin dose missed");
});

test("keys round-trip, the line names each medicine once, and nothing is due before discharge", () => {
  const at = new Date("2026-09-27T08:00:00+08:00");
  expect(parseDoseKey(doseKey("Azithromycin", at))).toEqual({ name: "Azithromycin", dueAt: at });
  expect(parseDoseKey("nonsense")).toBeUndefined();
  expect(missedLine({ missed: [{ name: "A", dueAt: at }, { name: "B", dueAt: at }] })).toBe("2 doses missed (A, B)");
  expect(missedLine({ missed: [] })).toBeUndefined();
  expect(adherence(meds, undefined, [], new Date())).toEqual({ due: 0, taken: 0, missed: [], late: [] });
});
