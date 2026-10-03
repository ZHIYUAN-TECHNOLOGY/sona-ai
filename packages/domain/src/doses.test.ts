import { expect, test } from "bun:test";

import { adherence, courseFinished, doseKey, lastDose, missedLine, parseDoseKey } from "./doses";

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

test("a course ends with its last dose and is finished once that dose can no longer be taken; an ongoing medicine has no end", () => {
  const last = lastDose(meds[0]!, new Date(out))!; // 3 doses after Saturday afternoon: Sun, Mon and Tue at 08:00
  expect(last).toEqual(new Date("2026-09-29T08:00:00+08:00"));
  expect(courseFinished(last, new Date("2026-09-29T13:59:00+08:00"))).toBe(false); // still open to log
  expect(courseFinished(last, new Date("2026-09-29T14:00:00+08:00"))).toBe(true);
  expect(lastDose(meds[1]!, new Date(out))).toBeUndefined();
  expect(lastDose({ name: "Paracetamol", line: "", doses: 4 }, new Date(out))).toBeUndefined(); // as needed: no times to end on
});

test("keys round-trip, the line names each medicine once, and nothing is due before discharge", () => {
  const at = new Date("2026-09-27T08:00:00+08:00");
  expect(parseDoseKey(doseKey("Azithromycin", at))).toEqual({ name: "Azithromycin", dueAt: at });
  expect(parseDoseKey("nonsense")).toBeUndefined();
  expect(missedLine({ missed: [{ name: "A", dueAt: at }, { name: "B", dueAt: at }] })).toBe("2 doses missed (A, B)");
  expect(missedLine({ missed: [] })).toBeUndefined();
  expect(adherence(meds, undefined, [], new Date())).toEqual({ due: 0, taken: 0, missed: [], late: [] });
});
