import { expect, test } from "bun:test";
import { bringLine, dotTone, followUpNeeds, nextVisit, pillLine, visitsLine, whenLine } from "./lines";

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
