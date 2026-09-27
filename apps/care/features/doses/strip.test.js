import { expect, test } from "bun:test";
import { checkState, foodOf, insight, weekStrip } from "./strip";

const now = new Date("2026-09-27T04:00:00Z"); // Sun 27 Sep, noon in Malaysia
const dose = (iso, taken = false) => ({ name: "Cetirizine", line: "", dueAt: new Date(iso), key: `Cetirizine@${iso}`, taken });

test("the strip shows up to 3 days back, today selected, then the days ahead; dots only on days so far", () => {
  const week = ["all", "none", "some", "all", "ahead"].map(state => ({ label: "", state }));
  const days = weekStrip(week, now);
  expect(days.map(d => `${d.weekday} ${d.date}`)).toEqual(["Thu 24", "Fri 25", "Sat 26", "Sun 27", "Mon 28", "Tue 29", "Wed 30"]);
  expect(days.map(d => d.mark ?? "-")).toEqual(["amber", "amber", "green", "-", "-", "-", "-"]);
  expect(days.findIndex(d => d.today)).toBe(3);
  expect(weekStrip([{ label: "", state: "ahead" }], now).findIndex(d => d.today)).toBe(0); // discharged today
});

test("a dose is holdable from 2 h before until 6 h late; later ones wait, missed ones are never offered", () => {
  expect(checkState(dose("2026-09-27T05:30:00Z"), now)).toBe("now");
  expect(checkState(dose("2026-09-27T03:00:00Z"), now)).toBe("now");
  expect(checkState(dose("2026-09-27T13:00:00Z"), now)).toBe("later");
  expect(checkState(dose("2026-09-26T21:00:00Z"), now)).toBe("missed");
  expect(checkState(dose("2026-09-26T21:00:00Z", true), now)).toBe("taken");
});

test("the insight names a late dose first, then all taken, else the count, missed and next time", () => {
  expect(insight([], now)).toEqual({ text: "Nothing due today", tone: "muted" });
  expect(insight([dose("2026-09-27T00:00:00Z", true), dose("2026-09-27T03:40:00Z")], now)).toEqual({ text: "Cetirizine is 20 min late", tone: "amber" });
  expect(insight([dose("2026-09-27T00:00:00Z", true), dose("2026-09-27T13:00:00Z", true)], now)).toEqual({ text: "All taken today", tone: "green" });
  expect(insight([dose("2026-09-27T00:00:00Z", true), dose("2026-09-27T13:00:00Z")], now)).toEqual({ text: "1 of 2 taken · next 9:00 PM", tone: "muted" });
  expect(insight([dose("2026-09-26T21:00:00Z"), dose("2026-09-27T13:00:00Z")], now)).toEqual({ text: "0 of 2 taken · 1 missed · next 9:00 PM", tone: "amber" });
});

test("food timing only when the take line names before or after", () => {
  expect(foodOf("1 tablet after food")).toBe("after");
  expect(foodOf("Take before meals")).toBe("before");
  expect(foodOf("1 tablet, with or without food")).toBeUndefined();
  expect(foodOf("1 tablet at night")).toBeUndefined();
});
