import { expect, test } from "bun:test";
import { doseKey } from "./doses/model";
import { consistency, daysHome, doseStatus, headerDate, latestUpdate, needsLine, nextCapsule, sparkPath, weekLine } from "./home";

test("days at home count calendar days in Malaysia, from the discharge day", () => {
  expect(daysHome("2026-09-26T15:30:00Z", new Date("2026-09-26T16:30:00Z"))).toBe(1); // 23:30 → 00:30 +08:00 is the next day
  expect(daysHome("2026-09-26T02:00:00Z", new Date("2026-09-28T01:00:00Z"))).toBe(2);
  expect(daysHome(undefined)).toBeUndefined();
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

test("consistency: the share of the week's doses taken, counting only those taken or missed, once two days have counted", () => {
  expect(consistency(meds, out, [], new Date("2026-09-27T05:00:00Z"))).toBeUndefined(); // tonight's dose is still to come
  expect(consistency(meds, out, all, wed)).toBe(100);
  expect(consistency(meds, out, [all[0], all[2]], wed)).toBe(67);
  expect(consistency(meds, out, [all[0]], new Date("2026-09-28T14:00:00Z"))).toBeUndefined(); // Monday's is late, not missed yet: one day is too soon to show
  expect(consistency(meds, out, [all[0]], new Date("2026-09-29T05:00:00Z"))).toBe(50); // two days counted
  expect(consistency([], out, [], wed)).toBeUndefined();
});

test("the medicines capsule says when the next dose is, plainly", () => {
  const due = new Date("2026-09-27T13:00:00Z"); // 9:00 PM Sun, Malaysia
  expect(nextCapsule(due, new Date("2026-09-27T05:00:00Z"))).toBe("Next at 9:00\u00a0PM");
  expect(nextCapsule(due, new Date("2026-09-26T13:30:00Z"))).toBe("Tomorrow 9:00\u00a0PM");
  expect(nextCapsule(due, new Date("2026-09-25T05:00:00Z"))).toBe("Sun 27 Sep 9:00\u00a0PM");
});

test("the header date reads in Malaysia time", () => {
  expect(headerDate(new Date("2026-09-26T16:30:00Z"))).toBe("Sun, 27 Sep");
});

test("the latest update: a waiting reply, then today's check-in, else nothing (the tile hides)", () => {
  const now = new Date("2026-09-29T05:00:00Z"), due = new Date("2026-09-29T02:00:00Z");
  const answered = label => [{ dueAt: due, sentAt: due, replies: [{ label, receivedAt: new Date("2026-09-29T03:00:00Z") }] }];
  expect(latestUpdate(answered("fine"), true, now).line).toBe("Care team replied");
  expect(latestUpdate(answered("fine"), false, now)).toEqual({ line: "Check-in done · all fine", tone: "green", face: "smile", to: "check-ins" });
  expect(latestUpdate(answered("worse"), false, now, "tomorrow 9:00 AM")).toEqual({ line: "Your doctor booked you in · tomorrow 9:00 AM", tone: "blue", face: "smile", to: "follow-ups" });
  expect(latestUpdate(answered("worse"), false, now, "tomorrow 9:00 AM", "CT scan").line).toBe("Your doctor booked you in · tomorrow 9:00 AM, with a CT scan");
  expect(latestUpdate(answered("worse"), false, now).tone).toBe("amber");
  expect(latestUpdate([{ dueAt: due, sentAt: due, replies: [] }], false, now).to).toBe("check-in");
  expect(latestUpdate([{ dueAt: new Date("2026-09-28T02:00:00Z"), sentAt: null, replies: [{ label: "fine", receivedAt: new Date("2026-09-28T15:00:00Z") }] }], false, now)).toBeUndefined();
  expect(latestUpdate(undefined, false, now)).toBeUndefined();
});
