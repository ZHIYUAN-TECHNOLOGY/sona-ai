import { expect, test } from "bun:test";
import { agendaOf, bringLine, dateOf, dayA11y, dayOf, emptyLine, followUpNeeds, marksByDay, nextUp, nextVisit, openRequests, pillLine, scheduleLine, weekAround, weekLabel, whenLine } from "./lines";

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
  const visits = [{ short: "Clinic review", date: new Date("2026-10-04T02:00:00Z"), status: "due-soon" }, { short: "CT scan", date: new Date("2026-09-20T02:00:00Z"), status: "missed" }];
  const checkIns = [{ day: 7, dueAt: new Date("2026-10-01T01:00:00Z") }];
  const week = [{ state: "all" }, { state: "some" }, { state: "free" }, { state: "ahead" }]; // 24–27 Sep
  const marks = marksByDay(today, visits, checkIns, week);
  expect(marks[D("2026-10-04")]).toEqual({ visit: "due" });
  expect(marks[D("2026-09-20")]).toEqual({ visit: "missed" });
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
  expect(items[0]).toMatchObject({ line: "30 min late · Amlodipine, Metformin", tone: "amber", soon: "morning medicines" });
  expect(items[2].soon).toMatch(/^evening medicines at 8:00\sPM$/);
  const done = agendaOf(now, { visits: [], checkIns: [], doses: [dose("Amlodipine", "2026-09-27T00:30:00Z", true)] })[0];
  expect(done).toMatchObject({ done: true, tone: "green", line: "Taken · Amlodipine", action: undefined });
});

test("visits read before you go; an all-day visit or a past day's doses come first", () => {
  const now = new Date("2026-09-27T01:00:00Z");
  const items = agendaOf(now, { visits: [visit({ id: "recall:f1", title: "CT scan", status: "missed", inDays: -2 })], checkIns: [], doses: [], doseMark: "missed" });
  expect(items.map(i => [i.title, i.line, i.tone, i.action])).toEqual([["CT scan", "Missed, was 2 days ago", "amber", "prepare"], ["Medicines", "Some doses missed", "amber", undefined]]);
  expect(items[0].at).toBeUndefined();
});

test("the insight line says what is next today and when the next visit is, amber when late or missed", () => {
  const now = new Date("2026-09-27T00:00:00Z"); // 8:00 AM
  const today = agendaOf(now, { visits: [], checkIns: [ask(3, "2026-09-27T01:00:00Z")], doses: [] });
  expect(scheduleLine(today, [visit()])).toEqual({ line: expect.stringMatching(/^Next: check-in at 9:00\sAM · visit in 3 days$/), tone: "muted" });
  expect(scheduleLine([], [visit({ status: "missed", inDays: -1 })])).toEqual({ line: "Visit missed", tone: "amber" });
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

test("counts the follow-ups that need the patient", () => {
  const items = [item("CT scan", "2026-12-25T02:00:00Z", 5, "due-soon"), item("Clinic review", "2027-01-10T02:00:00Z", 21, "upcoming")];
  expect(followUpNeeds([{ ...items[0], status: "missed" }, ...items])).toBe(2);
  expect(followUpNeeds(undefined)).toBe(0);
});

test("the Schedule shows waiting requests and a declined one until she asks that doctor again; confirmed and past ones are not requests", () => {
  const now = new Date("2026-09-28T02:00:00Z");
  const req = (id, over = {}) => ({ id, doctorId: "lim", startsAt: new Date("2026-10-01T02:30:00Z"), status: "requested", createdAt: new Date("2026-09-28T01:00:00Z"), ...over });
  const list = [
    req("later", { startsAt: new Date("2026-10-05T01:00:00Z") }),
    req("soon", { doctorId: "priya", startsAt: new Date("2026-09-29T01:30:00Z") }),
    req("declined", { doctorId: "arjun", status: "declined" }),
    req("confirmed", { doctorId: "tan", status: "confirmed" }),
    req("past", { doctorId: "farah", startsAt: new Date("2026-09-27T01:00:00Z") }),
  ];
  expect(openRequests(list, now).map(r => r.id)).toEqual(["soon", "declined", "later"]);
  // Asking Dr. Arjun again replaces the declined one.
  const again = req("again", { doctorId: "arjun", createdAt: new Date("2026-09-28T01:30:00Z") });
  expect(openRequests([...list, again], now).map(r => r.id)).not.toContain("declined");
});

test("the next visit is the earliest one not yet attended, never a visit already seen", () => {
  const seen = visit({ id: "seen", status: "attended", inDays: -1 }), review = visit({ id: "review", status: "upcoming", inDays: 13 });
  expect(nextVisit([seen, review])).toBe(review);
  expect(nextVisit([seen])).toBeUndefined();
  expect(nextVisit(undefined)).toBeUndefined();
});

test("a late dose leads the insight line plainly; only its row says late", () => {
  const now = new Date("2026-09-27T01:00:00Z");
  const today = agendaOf(now, { visits: [], checkIns: [], doses: [dose("Azithromycin", "2026-09-27T00:00:00Z")] });
  expect(scheduleLine(today, [visit({ status: "upcoming", inDays: 13 })])).toEqual({ line: "Next: morning medicines · visit in 13 days", tone: "muted" });
});

test("a visit she already had needs nothing and never leads the insight line", () => {
  expect(followUpNeeds([visit({ status: "attended", inDays: -1 }), visit({ status: "upcoming", inDays: 9 })])).toBe(0);
  expect(scheduleLine([], [visit({ status: "attended", inDays: -1 }), visit({ status: "due-soon", inDays: 3 })]).line).toBe("Visit in 3 days");
});
