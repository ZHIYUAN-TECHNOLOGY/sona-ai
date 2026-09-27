import { expect, test } from "bun:test";
import { followUpNeeds, nextVisit, whenLine } from "./lines";

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
