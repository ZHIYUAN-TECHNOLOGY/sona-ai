import { expect, test } from "bun:test";
import { doseKey } from "./doses/model";
import { checkInToday, daysHome, doseStatus, headline, needsLine, recovery, sparkPath, weekLine } from "./home";

test("days at home count calendar days in Malaysia, from the discharge day", () => {
  expect(daysHome("2026-09-26T15:30:00Z", new Date("2026-09-26T16:30:00Z"))).toBe(1); // 23:30 → 00:30 +08:00 is the next day
  expect(daysHome("2026-09-26T02:00:00Z", new Date("2026-09-28T01:00:00Z"))).toBe(2);
  expect(daysHome(undefined)).toBeUndefined();
});

test("the headline names the most urgent open thing, else reads as positive", () => {
  expect(headline([])).toBe("Positive today");
  expect(headline([{ kind: "check-in" }, { kind: "dose", name: "Cetirizine" }])).toBe("Time for Cetirizine");
  expect(headline([{ kind: "visit", inDays: -2, overdue: true }, { kind: "check-in" }])).toBe("Visit overdue");
  expect(headline([{ kind: "reply" }, { kind: "check-in" }])).toBe("Check in today");
  expect(headline([{ kind: "visit", inDays: 1 }, { kind: "reply" }])).toBe("Care team replied");
  expect(headline([{ kind: "visit", inDays: 1 }])).toBe("Visit tomorrow");
  expect(headline([{ kind: "visit", inDays: 3 }])).toBe("Visit in 3 days");
});

test("today's check-in is pending while one waits, done once answered today, else none", () => {
  const now = new Date("2026-09-29T05:00:00Z"); // 1 PM Tue, Malaysia
  const due = new Date("2026-09-29T02:00:00Z");
  expect(checkInToday([{ dueAt: due, sentAt: due, replies: [] }], now)).toBe("pending");
  expect(checkInToday([{ dueAt: due, sentAt: due, replies: [{ receivedAt: new Date("2026-09-29T03:00:00Z") }] }], now)).toBe("done");
  expect(checkInToday([{ dueAt: new Date("2026-09-28T02:00:00Z"), sentAt: null, replies: [{ receivedAt: new Date("2026-09-28T15:00:00Z") }] }], now)).toBeUndefined(); // answered yesterday, 11 PM
  expect(checkInToday([{ dueAt: new Date("2026-10-04T02:00:00Z"), sentAt: null, replies: [] }], now)).toBeUndefined(); // the next one isn't due
});

test("recovery today: each part from real data, parts with nothing today left out, the furthest behind next", () => {
  const r = recovery({ doses: [{ taken: true }, { taken: false }], checkIn: "done", glasses: 2, visit: { inDays: 7, overdue: false } });
  expect(r.parts.map(p => [p.key, p.share, p.note])).toEqual([
    ["medicines", 0.5, "1 of 2 taken"], ["check-in", 1, "Done"], ["water", 0.25, "2 of 8 glasses"], ["visits", 1, "Booked · in 7 days"],
  ]);
  expect(r.pct).toBe(69);
  expect(r.next).toBe("water");
  const quiet = recovery({ doses: [], glasses: 12 });
  expect(quiet.parts.map(p => p.note)).toEqual(["None due today", "None today", "8 of 8 glasses", "None booked"]);
  expect([quiet.pct, quiet.next]).toEqual([100, undefined]);
  const late = recovery({ doses: [{ taken: true }], checkIn: "pending", glasses: 8, visit: { inDays: -3, overdue: true } });
  expect([late.pct, late.next, late.parts[3].note]).toEqual([50, "check-in", "Overdue"]);
});

test("the dose sparkline runs through days with doses due, skipping days still to come or free", () => {
  const week = ["all", "some", "free", "none", "ahead"].map(state => ({ label: "M", state }));
  expect(sparkPath(week, 46, 26)).toBe("M3 3 L13 13 L33 23");
  expect(sparkPath([{ label: "S", state: "all" }], 46, 26)).toBeUndefined();
  expect(sparkPath([], 46, 26)).toBeUndefined();
});

test("the insight line says how much needs you and for how long", () => {
  expect(needsLine([{ kind: "dose" }])).toBe("1 thing needs you · about 1 min");
  expect(needsLine([{ kind: "dose" }, { kind: "check-in" }])).toBe("2 things need you · about 1 min");
  expect(needsLine([{ kind: "reply" }, { kind: "visit" }, { kind: "dose" }, { kind: "check-in" }])).toBe("4 things need you · about 2 min");
  expect(needsLine([])).toBe("All done for today");
});

test("the next dose's status: how far off, amber within half an hour and once due", () => {
  const due = new Date("2026-09-27T13:00:00Z"); // 9:00 PM Malaysia
  expect(doseStatus(due, new Date("2026-09-27T05:00:00Z"))).toEqual({ text: "In 8 h", tone: "muted" });
  expect(doseStatus(due, new Date("2026-09-27T12:41:30Z"))).toEqual({ text: "Due in 19 min", tone: "amber" });
  expect(doseStatus(due, new Date("2026-09-26T13:30:00Z"))).toEqual({ text: "Tomorrow", tone: "muted" });
  expect(doseStatus(due, new Date("2026-09-25T13:30:00Z")).text).toBe("Sun 27 Sep");
  expect(doseStatus(due, new Date("2026-09-27T13:02:00Z"))).toEqual({ text: "Due now", tone: "amber" });
  expect(doseStatus(due, new Date("2026-09-27T13:20:00Z"))).toEqual({ text: "20 min late", tone: "amber" });
});

// Discharged Sun 27 Sep 10:00 Malaysia; cetirizine nightly at 21:00.
const out = "2026-09-27T02:00:00Z";
const meds = [{ name: "Cetirizine", line: "Keep taking it as before", at: ["21:00"] }];
const night = day => new Date(`2026-09-${day}T13:00:00Z`);
const all = [27, 28, 29].map(d => doseKey("Cetirizine", night(d)));
const wed = new Date("2026-09-30T05:00:00Z"); // Wed, 1 PM

test("this week's line: every dose taken, or how many were missed and when", () => {
  expect(weekLine(meds, out, [], new Date("2026-09-27T05:00:00Z"))).toEqual({ text: "Nothing missed so far", tone: "muted" });
  expect(weekLine([], out, [], new Date("2026-09-27T05:00:00Z")).text).toBe("Nothing on a timer this week");
  expect(weekLine(meds, out, all, wed)).toEqual({ text: "Every dose taken", tone: "green" });
  expect(weekLine(meds, out, [all[0], all[2]], wed)).toEqual({ text: "1 dose missed on Mon", tone: "amber" });
  expect(weekLine(meds, out, [all[0]], wed)).toEqual({ text: "2 doses missed this week", tone: "amber" });
  // Within 6 h of 9 PM it is still the next dose, not missed.
  expect(weekLine(meds, out, all, new Date("2026-09-30T14:00:00Z")).text).toBe("Every dose taken");
});
