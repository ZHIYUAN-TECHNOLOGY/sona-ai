import { expect, test } from "bun:test";
import { clock, doseOf, dosesToday, dueNow, early, nextDose, untilLine, weekOf, whenWords } from "./model";

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

test("a reminder opens its own dose, until it is taken or if it is not in the plan", () => {
  const key = "Azithromycin@2026-09-28T00:00:00.000Z";
  expect(doseOf(meds, key, [])).toEqual({ name: "Azithromycin", line: "1 tablet, with or without food", dueAt: new Date("2026-09-28T00:00:00Z"), key });
  expect(doseOf(meds, key, [key])).toBeUndefined();
  expect(doseOf(meds, "Warfarin@2026-09-28T00:00:00.000Z", [])).toBeUndefined();
  expect(doseOf(meds, "Paracetamol@2026-09-28T00:00:00.000Z", [])).toBeUndefined(); // as needed: nothing to remind
  expect(doseOf(meds, "not a key", [])).toBeUndefined();
  expect(doseOf(meds, undefined, [])).toBeUndefined();
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

test("today's doses are the ones due on this Malaysia day, marked taken or not", () => {
  const now = at("2026-09-28T02:00:00Z"); // 10:00 on 28 Sep
  const day = dosesToday(meds, out, [], now);
  expect(day.map(d => d.name)).toEqual(["Azithromycin", "Cetirizine"]); // 08:00 and 21:00; paracetamol has no times
  const taken = dosesToday(meds, out, [day[0].key], now);
  expect(taken.map(d => d.taken)).toEqual([true, false]);
  expect(dosesToday(meds, undefined, [], now)).toEqual([]);
});

test("the week shows each day since discharge: all taken, some, none, still ahead, or nothing due", () => {
  const now = at("2026-09-29T02:00:00Z"); // 10:00 on 29 Sep; discharged 27 Sep
  const d27 = nextDose(meds, out, [], at("2026-09-27T05:00:00Z")); // cetirizine 21:00 on 27 Sep
  const d28 = dosesToday(meds, out, [], at("2026-09-28T02:00:00Z"));
  const week = weekOf(meds, out, [d27.key, d28[0].key], now);
  expect(week.map(d => d.state)).toEqual(["all", "some", "none"]); // 27 all; 28 missed cetirizine; 29 azithro 08:00 is past and not taken
  expect(week).toHaveLength(3);
  const fresh = weekOf(meds, out, [d27.key, ...d28.map(d => d.key)], at("2026-09-29T23:00:00Z"));
  expect(fresh.at(-1).state).toBe("ahead"); // 07:00 on 30 Sep: the azithromycin course has ended, cetirizine is due at 21:00
});
