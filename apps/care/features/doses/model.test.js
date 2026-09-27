import { expect, test } from "bun:test";
import { clock, dueNow, early, nextDose, untilLine, whenWords } from "./model";

// Discharged 10:00 Malaysia time (02:00Z) on 27 Sep; azithromycin 08:00 for 2 more doses, cetirizine nightly at 21:00.
const out = "2026-09-27T02:00:00Z";
const meds = [
  { name: "Azithromycin", line: "Now a tablet once a day, for 2 more days", take: "1 tablet, with or without food", at: ["08:00"], doses: 2 },
  { name: "Paracetamol", line: "If you need it" },
  { name: "Cetirizine", line: "Keep taking it as before", at: ["21:00"] },
];
const at = iso => new Date(iso);

test("the next dose is the earliest one after leaving hospital that is not taken", () => {
  const first = nextDose(meds, out, [], at("2026-09-27T05:00:00Z"));
  expect(first.name).toBe("Cetirizine");
  expect(first.line).toBe("Keep taking it as before"); // no dose instruction: the plan's line
  expect(first.dueAt.toISOString()).toBe("2026-09-27T13:00:00.000Z"); // 21:00 +08:00; the 08:00 slot that day was before discharge
  const second = nextDose(meds, out, [first.key], at("2026-09-27T13:05:00Z"));
  expect(second.name).toBe("Azithromycin");
  expect(second.line).toBe("1 tablet, with or without food");
  expect(second.dueAt.toISOString()).toBe("2026-09-28T00:00:00.000Z");
});

test("a course stops after its doses; medicines without times never appear", () => {
  const taken = [];
  const names = [];
  let now = at("2026-09-27T05:00:00Z");
  for (let i = 0; i < 6; i++) {
    const d = nextDose(meds, out, taken, now);
    names.push(d.name);
    taken.push(d.key);
    now = d.dueAt;
  }
  expect(names).toEqual(["Cetirizine", "Azithromycin", "Cetirizine", "Azithromycin", "Cetirizine", "Cetirizine"]);
});

test("a missed dose stays next for a few hours, then gives way", () => {
  expect(nextDose(meds, out, [], at("2026-09-27T15:00:00Z")).name).toBe("Cetirizine"); // 2 h late
  expect(nextDose(meds, out, [], at("2026-09-27T21:00:00Z")).name).toBe("Azithromycin"); // 8 h late: move on
});

test("nothing scheduled, or not home yet, means no dose", () => {
  expect(nextDose([meds[1]], out, [], at("2026-09-27T05:00:00Z"))).toBeUndefined();
  expect(nextDose(meds, undefined, [], at("2026-09-27T05:00:00Z"))).toBeUndefined();
});

test("time words read in Malaysia time and say how long to wait", () => {
  expect(clock(at("2026-09-27T13:00:00Z"))).toBe("9:00 PM");
  const due = at("2026-09-27T13:00:00Z");
  expect(untilLine(due, at("2026-09-27T10:50:00Z"))).toBe("in 2 h 10 min");
  expect(untilLine(due, at("2026-09-27T12:20:00Z"))).toBe("in 40 min");
  expect(untilLine(due, at("2026-09-27T12:58:00Z"))).toBe("now");
  expect(untilLine(due, at("2026-09-27T14:30:00Z"))).toBe("1 h 30 min late");
  expect(dueNow(due, at("2026-09-27T12:31:00Z"))).toBe(true);
  expect(dueNow(due, at("2026-09-27T12:20:00Z"))).toBe(false);
  expect(early(due, at("2026-09-27T10:50:00Z"))).toBe(true);
  expect(early(due, at("2026-09-27T11:10:00Z"))).toBe(false);
});

test("the next dose after taking one reads as a day word and a time", () => {
  const now = at("2026-09-27T13:05:00Z"); // 21:05 Malaysia
  expect(whenWords(at("2026-09-27T14:00:00Z"), now)).toBe("today 10:00 PM");
  expect(whenWords(at("2026-09-28T00:00:00Z"), now)).toBe("tomorrow 8:00 AM");
  expect(whenWords(at("2026-09-29T00:00:00Z"), now)).toBe("Tue 29 Sep 8:00 AM");
});
