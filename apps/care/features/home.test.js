import { expect, test } from "bun:test";
import { doseKey } from "./doses/model";
import { checkInsLine, countdown, daysHome, needsLine, weekLine, whereWords } from "./home";

test("days at home count calendar days in Malaysia, from the discharge day", () => {
  expect(daysHome("2026-09-26T15:30:00Z", new Date("2026-09-26T16:30:00Z"))).toBe(1); // 23:30 → 00:30 +08:00 is the next day
  expect(daysHome("2026-09-26T02:00:00Z", new Date("2026-09-28T01:00:00Z"))).toBe(2);
  expect(daysHome(undefined)).toBeUndefined();
});

test("the title says where you are, the line how much needs you and for how long", () => {
  expect(whereWords(2)).toEqual(["Day 2", " at home"]);
  expect(whereWords(0)).toEqual(["Home", " today"]);
  expect(whereWords(undefined)).toEqual(["Your care", " between visits"]);
  expect(needsLine([{ kind: "dose" }])).toBe("1 thing needs you · about 1 min");
  expect(needsLine([{ kind: "dose" }, { kind: "check-in" }])).toBe("2 things need you · about 1 min");
  expect(needsLine([{ kind: "reply" }, { kind: "visit" }, { kind: "dose" }, { kind: "check-in" }])).toBe("4 things need you · about 2 min");
  expect(needsLine([])).toBe("All done for today");
});

test("the medicine card ticks in the last hour, shows the time further off, and says when it is due", () => {
  const due = new Date("2026-09-27T13:00:00Z"); // 9:00 PM Malaysia
  expect(countdown(due, new Date("2026-09-27T12:41:26Z"))).toEqual({ kicker: "Next medicine in", value: "18:34", due: true, ticking: true });
  expect(countdown(due, new Date("2026-09-27T12:10:00Z")).due).toBe(false);
  expect(countdown(due, new Date("2026-09-27T05:00:00Z"))).toEqual({ kicker: "Next medicine at", value: "9:00 PM", due: false, ticking: false });
  expect(countdown(due, new Date("2026-09-26T13:30:00Z")).kicker).toBe("Next medicine tomorrow");
  expect(countdown(due, new Date("2026-09-27T13:02:00Z")).kicker).toBe("Due now");
  expect(countdown(due, new Date("2026-09-27T13:20:00Z"))).toEqual({ kicker: "20 min late", value: "9:00 PM", due: true, ticking: false });
});

// Discharged Sun 27 Sep 10:00 Malaysia; cetirizine nightly at 21:00.
const out = "2026-09-27T02:00:00Z";
const meds = [{ name: "Cetirizine", line: "Keep taking it as before", at: ["21:00"] }];
const night = day => new Date(`2026-09-${day}T13:00:00Z`);

test("this week's line: every dose taken, or how many were missed and when", () => {
  expect(weekLine(meds, out, [], new Date("2026-09-27T05:00:00Z"))).toEqual({ text: "Nothing missed so far", tone: "muted" });
  expect(weekLine([], out, [], new Date("2026-09-27T05:00:00Z")).text).toBe("Nothing on a timer this week");
  const now = new Date("2026-09-30T05:00:00Z"); // Wed, 1 PM
  const all = [27, 28, 29].map(d => doseKey("Cetirizine", night(d)));
  expect(weekLine(meds, out, all, now)).toEqual({ text: "Every dose taken", tone: "green" });
  expect(weekLine(meds, out, [all[0], all[2]], now)).toEqual({ text: "1 dose missed on Mon", tone: "amber" });
  expect(weekLine(meds, out, [all[0]], now)).toEqual({ text: "2 doses missed this week", tone: "amber" });
  // Within 6 h of 9 PM it is still the next dose, not missed.
  expect(weekLine(meds, out, all, new Date("2026-09-30T14:00:00Z")).text).toBe("Every dose taken");
});

test("check-ins answered, once there are any", () => {
  expect(checkInsLine([{ replies: [{}] }, { replies: [] }])).toBe("Check-ins: 1 of 2 answered");
  expect(checkInsLine([])).toBeUndefined();
  expect(checkInsLine(undefined)).toBeUndefined();
});
