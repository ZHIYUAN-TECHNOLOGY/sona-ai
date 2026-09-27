import { expect, test } from "bun:test";
import { doseKey } from "./doses/model";
import { consistency, countdown, daysHome, headerDate, latestLine, needsLine, nextLine, weekLine } from "./home";

test("days at home count calendar days in Malaysia, from the discharge day", () => {
  expect(daysHome("2026-09-26T15:30:00Z", new Date("2026-09-26T16:30:00Z"))).toBe(1); // 23:30 → 00:30 +08:00 is the next day
  expect(daysHome("2026-09-26T02:00:00Z", new Date("2026-09-28T01:00:00Z"))).toBe(2);
  expect(daysHome(undefined)).toBeUndefined();
});

test("the header dates today in Malaysia", () => {
  expect(headerDate(new Date("2026-09-27T05:00:00Z"))).toBe("Sun, 27 Sep");
  expect(headerDate(new Date("2026-09-27T17:00:00Z"))).toBe("Mon, 28 Sep"); // 1 AM Monday in Malaysia
});

test("the insight line says how much needs you and for how long", () => {
  expect(needsLine([{ kind: "dose" }])).toBe("1 thing needs you · about 1 min");
  expect(needsLine([{ kind: "dose" }, { kind: "check-in" }])).toBe("2 things need you · about 1 min");
  expect(needsLine([{ kind: "reply" }, { kind: "visit" }, { kind: "dose" }, { kind: "check-in" }])).toBe("4 things need you · about 2 min");
  expect(needsLine([])).toBe("All done for today");
});

test("the medicine countdown ticks in the last hour, shows the time further off, and says when it is due", () => {
  const due = new Date("2026-09-27T13:00:00Z"); // 9:00 PM Malaysia
  expect(countdown(due, new Date("2026-09-27T12:41:26Z"))).toEqual({ kicker: "Next medicine in", value: "18:34", due: true, ticking: true });
  expect(countdown(due, new Date("2026-09-27T12:10:00Z")).due).toBe(false);
  expect(countdown(due, new Date("2026-09-27T05:00:00Z"))).toEqual({ kicker: "Next medicine at", value: "9:00 PM", due: false, ticking: false });
  expect(countdown(due, new Date("2026-09-26T13:30:00Z")).kicker).toBe("Next medicine tomorrow");
  expect(countdown(due, new Date("2026-09-27T13:02:00Z")).kicker).toBe("Due now");
  expect(countdown(due, new Date("2026-09-27T13:20:00Z"))).toEqual({ kicker: "20 min late", value: "9:00 PM", due: true, ticking: false });
});

test("the medicine pill: a countdown in the last hour, the time further off, amber once due", () => {
  const due = new Date("2026-09-27T13:00:00Z");
  expect(nextLine(due, new Date("2026-09-27T12:41:26Z"))).toEqual({ text: "Next in 18:34", due: true, ticking: true });
  expect(nextLine(due, new Date("2026-09-27T05:00:00Z"))).toEqual({ text: "Next 9:00 PM", due: false, ticking: false });
  expect(nextLine(due, new Date("2026-09-26T13:30:00Z")).text).toBe("Tomorrow 9:00 PM");
  expect(nextLine(due, new Date("2026-09-27T13:02:00Z"))).toEqual({ text: "Due now · 9:00 PM", due: true, ticking: false });
  expect(nextLine(due, new Date("2026-09-27T13:20:00Z")).text).toBe("20 min late · 9:00 PM");
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

test("consistency: taken over due, a dose counting once taken or 6 h late", () => {
  expect(consistency(meds, out, [], new Date("2026-09-27T05:00:00Z"))).toBeUndefined(); // nothing due yet
  expect(consistency(meds, undefined, [], wed)).toBeUndefined();
  expect(consistency(meds, out, all, wed)).toBe(100);
  expect(consistency(meds, out, [all[0], all[2]], wed)).toBe(67);
  expect(consistency(meds, out, [all[0], all[1]], new Date("2026-09-29T14:00:00Z"))).toBe(100); // tonight's is not late yet
  expect(consistency(meds, out, [...all, doseKey("Cetirizine", night(30))], wed)).toBe(100); // taken early counts
});

test("latest update: a waiting reply's words, a sent message's status, else reassurance", () => {
  const reply = [{ from: "patient", text: "Is the rash normal?" }, { from: "care-team", text: "Yes, it should fade in a few days." }];
  expect(latestLine(reply, true, false)).toEqual({ lead: "Care team replied", text: "Yes, it should fade in a few days.", tone: "ink" });
  expect(latestLine(reply.slice(0, 1), false, true)).toEqual({ lead: "Message sent", text: "Usually replies within a few hours", tone: "muted" });
  expect(latestLine(reply, false, true)).toEqual({ text: "✦ Nothing needs you", tone: "green" });
  expect(latestLine(undefined, false, false)).toEqual({ text: "✦ No new messages", tone: "green" });
});
