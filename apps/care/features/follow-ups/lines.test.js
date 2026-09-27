import { expect, test } from "bun:test";
import { bringLine, dateOf, dayA11y, dayOf, dotTone, emptyLine, followUpNeeds, marksByDay, monthGrid, monthLabel, monthOf, nextUp, nextVisit, pillLine, shiftMonth, visitsLine, whenLine } from "./lines";

const D = (iso) => Date.UTC(...iso.split("-").map((n, i) => Number(n) - (i === 1 ? 1 : 0))) / 86_400_000; // "2026-09-27" → day number
test("the calendar reads days in Malaysia and lays months out Monday first", () => {
  expect(dayOf("2026-09-26T16:30:00Z")).toBe(D("2026-09-27")); // 12:30 AM Sunday in Malaysia
  expect(dayOf("2026-09-26T15:59:00Z")).toBe(D("2026-09-26"));
  const sep = monthGrid({ year: 2026, month: 8 });
  expect(sep.length).toBe(5);
  expect(sep[0].slice(0, 2)).toEqual([null, D("2026-09-01")]); // 1 Sep 2026 is a Tuesday
  expect(sep[4].filter(Boolean).map(dateOf)).toEqual([28, 29, 30]);
  expect(monthGrid({ year: 2026, month: 10 }).length).toBe(6); // Nov starts on a Sunday
  expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
  expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
  expect(monthOf(D("2026-10-04"))).toEqual({ year: 2026, month: 9 });
  expect(monthLabel({ year: 2026, month: 8 }, D("2026-09-27"))).toBe("Sep");
  expect(monthLabel({ year: 2027, month: 0 }, D("2026-09-27"))).toBe("Jan 2027");
});

test("dots mark visits, check-ins and this week's doses; empty days point to what is next", () => {
  const today = D("2026-09-27");
  const visits = [{ short: "Clinic review", date: new Date("2026-10-04T02:00:00Z"), status: "due-soon" }, { short: "CT scan", date: new Date("2026-09-20T02:00:00Z"), status: "overdue" }];
  const checkIns = [{ day: 7, dueAt: new Date("2026-10-01T01:00:00Z") }];
  const week = [{ state: "all" }, { state: "some" }, { state: "free" }, { state: "ahead" }]; // 24–27 Sep
  const marks = marksByDay(today, visits, checkIns, week);
  expect(marks[D("2026-10-04")]).toEqual({ visit: "due" });
  expect(marks[D("2026-09-20")]).toEqual({ visit: "overdue" });
  expect(marks[D("2026-10-01")]).toEqual({ checkIn: true });
  expect([marks[D("2026-09-24")], marks[D("2026-09-25")], marks[D("2026-09-26")], marks[today]]).toEqual([{ doses: "taken" }, { doses: "missed" }, undefined, undefined]);
  expect(dayA11y(D("2026-10-04"), today, visits, checkIns)).toBe("Sunday 4 October, Clinic review");
  expect(dayA11y(D("2026-09-25"), D("2026-09-25"), visits, checkIns, marks[D("2026-09-25")])).toBe("Friday 25 September, today, some doses missed");
  expect(nextUp(today, visits, checkIns)).toEqual({ day: D("2026-10-01"), title: "Day 7 check-in" });
  expect(emptyLine(today, today, { day: D("2026-10-04"), title: "Clinic review" })).toBe("Nothing today · Next: Clinic review in 7 days");
  expect(emptyLine(D("2026-10-05"), today, undefined)).toBe("Nothing this day");
});

test("my visits says what is next and how far off, and colours the timeline dots", () => {
  expect(visitsLine([{ short: "Clinic review", status: "due-soon", inDays: 7 }])).toEqual({ line: "Next: Clinic review in 7 days", tone: "amber" });
  expect(visitsLine([{ short: "CT scan", status: "upcoming", inDays: 81 }])).toEqual({ line: "Next: CT scan in 81 days", tone: "muted" });
  expect(visitsLine([{ short: "CT scan", status: "overdue", inDays: -3 }])).toEqual({ line: "Overdue: CT scan, due 3 days ago", tone: "red" });
  expect(visitsLine([])).toBeUndefined();
  expect([dotTone({ status: "due-soon" }, true), dotTone({ status: "upcoming" }, false), dotTone({ status: "overdue" }, false)]).toEqual(["blue", "faint", "red"]);
});

test("the pill gives a booked visit its Malaysian time; a recall or the discharge review only its day", () => {
  expect(pillLine({ id: "appt-SYN-1042", date: new Date("2026-10-02T02:30:00Z") })).toMatch(/^Fri 2 Oct · 10:30\sAM$/);
  expect(pillLine({ id: "recall:f1", date: new Date("2026-12-25T02:00:00Z") })).toBe("Fri 25 Dec");
  expect(pillLine({ id: "discharge-review", date: new Date("2026-12-25T02:00:00Z") })).toBe("Fri 25 Dec");
  expect(bringLine({ id: "discharge-review" })).toContain("discharge letter");
  expect(bringLine({ id: "appt-SYN-1042" })).not.toContain("discharge letter");
});

const item = (short, date, inDays, status) => ({ short, date: new Date(date), inDays, status });
test("when reads the day in Malaysia and how far away it is", () => {
  expect(whenLine(item("CT scan", "2026-12-25T02:00:00Z", 90))).toBe("Fri 25 Dec · in 90 days");
  expect(whenLine(item("Clinic visit", "2026-09-26T16:30:00Z", 1))).toBe("Sun 27 Sep · tomorrow");
  expect(whenLine(item("Clinic visit", "2026-09-26T02:15:00Z", 0))).toBe("Sat 26 Sep · today");
  expect(whenLine(item("CT scan", "2026-12-25T02:00:00Z", -3))).toBe("Fri 25 Dec · 3 days ago");
});

test("the home tile dates the next one with its tone, and counts what needs the patient", () => {
  const items = [item("CT scan", "2026-12-25T02:00:00Z", 5, "due-soon"), item("Clinic review", "2027-01-10T02:00:00Z", 21, "upcoming")];
  expect(nextVisit(items)).toEqual({ value: "25 Dec", line: "CT scan · in 5 days", tone: "amber" });
  expect(nextVisit([{ ...items[0], status: "overdue" }])).toEqual({ value: "25 Dec", line: "CT scan · overdue", tone: "red" });
  expect(nextVisit([items[1]])).toEqual({ value: "10 Jan", line: "Clinic review · in 21 days", tone: "muted" });
  expect(nextVisit([])).toEqual({ value: "—", line: "Nothing booked yet", tone: "muted" });
  expect(followUpNeeds([{ ...items[0], status: "overdue" }, ...items])).toBe(2);
  expect(followUpNeeds(undefined)).toBe(0);
});
