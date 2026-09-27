import { expect, test } from "bun:test";
import { agendaOf, bringLine, dateOf, dayA11y, dayOf, emptyLine, followUpNeeds, marksByDay, nextUp, nextVisit, pillLine, scheduleLine, weekAround, weekLabel, whenLine } from "./lines";

const D = (iso) => Date.UTC(...iso.split("-").map((n, i) => Number(n) - (i === 1 ? 1 : 0))) / 86_400_000; // "2026-09-27" → day number
test("the strip reads days in Malaysia and shows the Monday-first week around the chosen day", () => {
  expect(dayOf("2026-09-26T16:30:00Z")).toBe(D("2026-09-27")); // 12:30 AM Sunday in Malaysia
  expect(dayOf("2026-09-26T15:59:00Z")).toBe(D("2026-09-26"));
  expect(weekAround(D("2026-09-27")).map(dateOf)).toEqual([21, 22, 23, 24, 25, 26, 27]); // a Sunday ends its week
  expect(weekAround(D("2026-09-28"))[0]).toBe(D("2026-09-28"));
  expect(weekLabel(weekAround(D("2026-10-01")))).toBe("28 Sep – 4 Oct");
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

const dose = (name, iso, taken = false) => ({ name, line: "1 tablet", dueAt: new Date(iso), key: `${name}@${iso}`, taken });
const ask = (day, iso, extra = {}) => ({ id: `c${day}`, day, language: "en", message: "", dueAt: new Date(iso), sentAt: null, replies: [], ...extra });
const visit = (extra = {}) => ({ id: "appt-1", title: "Cardiology clinic", short: "Cardiology clinic", why: "Your booked appointment", date: new Date("2026-09-30T02:30:00Z"), inDays: 3, status: "due-soon", ...extra });

test("a day's timeline groups doses by time, orders by time, and offers one action where it is due", () => {
  const now = new Date("2026-09-27T01:00:00Z"); // 9:00 AM in Malaysia
  const items = agendaOf(now, {
    visits: [], checkIns: [ask(3, "2026-09-27T01:30:00Z", { sentAt: new Date("2026-09-27T00:00:00Z") })],
    doses: [dose("Amlodipine", "2026-09-27T00:30:00Z"), dose("Metformin", "2026-09-27T00:30:00Z", true), dose("Metformin", "2026-09-27T12:00:00Z")],
  });
  expect(items.map(i => [i.title, i.action, i.done])).toEqual([["Morning medicines", "take", false], ["Day 3 check-in", "answer", false], ["Evening medicines", undefined, false]]);
  expect(items[0]).toMatchObject({ line: "30 min late · Amlodipine, Metformin", tone: "amber", soon: "morning medicines 30 min late" });
  expect(items[2].soon).toMatch(/^evening medicines at 8:00\sPM$/);
  const done = agendaOf(now, { visits: [], checkIns: [], doses: [dose("Amlodipine", "2026-09-27T00:30:00Z", true)] })[0];
  expect(done).toMatchObject({ done: true, tone: "green", line: "Taken · Amlodipine", action: undefined });
});

test("visits read before you go; an all-day visit or a past day's doses come first", () => {
  const now = new Date("2026-09-27T01:00:00Z");
  const items = agendaOf(now, { visits: [visit({ id: "recall:f1", title: "CT scan", status: "overdue", inDays: -2 })], checkIns: [], doses: [], doseMark: "missed" });
  expect(items.map(i => [i.title, i.line, i.tone, i.action])).toEqual([["CT scan", "Overdue, due 2 days ago", "amber", "prepare"], ["Medicines", "Some doses missed", "amber", undefined]]);
  expect(items[0].at).toBeUndefined();
});

test("the insight line says what is next today and when the next visit is, amber when late or overdue", () => {
  const now = new Date("2026-09-27T00:00:00Z"); // 8:00 AM
  const today = agendaOf(now, { visits: [], checkIns: [ask(3, "2026-09-27T01:00:00Z")], doses: [] });
  expect(scheduleLine(today, [visit()])).toEqual({ line: expect.stringMatching(/^Next: check-in at 9:00\sAM · visit in 3 days$/), tone: "muted" });
  expect(scheduleLine([], [visit({ status: "overdue", inDays: -1 })])).toEqual({ line: "Visit overdue", tone: "amber" });
  expect(scheduleLine(agendaOf(now, { visits: [], checkIns: [ask(3, "2026-09-27T01:00:00Z", { replies: [{}] })], doses: [] }), [])).toEqual({ line: "All done today", tone: "muted" });
  expect(scheduleLine([], [])).toEqual({ line: "Nothing booked yet", tone: "muted" });
  const visitToday = agendaOf(now, { visits: [visit({ inDays: 0, date: new Date("2026-09-27T02:30:00Z") })], checkIns: [], doses: [] });
  expect(scheduleLine(visitToday, [visitToday[0].visit]).line).toMatch(/^Next: visit at 10:30\sAM$/);
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
