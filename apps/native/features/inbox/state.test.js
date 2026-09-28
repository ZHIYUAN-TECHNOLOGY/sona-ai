import { expect, test } from "bun:test";
import { badge, insight, sections, waited } from "./state";

const now = "2026-09-26T04:00:00.000Z";
const row = (name, label, waitingSince, handled = false) => ({ patientId: name, name, label: handled ? null : label, waitingSince: handled ? null : waitingSince, handled });
const threads = [
  row("Amelia", "urgent", "2026-09-26T03:40:00.000Z"),
  row("Daniel", "clinical", "2026-09-26T02:00:00.000Z"),
  row("Farid", "clinical", "2026-09-26T03:00:00.000Z"),
  row("Mei", "admin", null, true),
];

test("the insight line says who is waiting, how many are urgent and the longest wait", () => {
  expect(insight(threads, now)).toBe("3 waiting · 1 urgent · longest 2 h");
  expect(insight(threads.slice(1), now)).toBe("2 waiting · longest 2 h");
  expect(insight([threads[3]], now)).toBe("All caught up");
  expect([waited("2026-09-26T03:59:40.000Z", now), waited("2026-09-26T03:48:00.000Z", now), waited("2026-09-23T04:00:00.000Z", now)]).toEqual(["just now", "12 min", "3 d"]);
});

test("sections are only the non-empty triage groups of waiting threads; the badge counts them, red when any is urgent", () => {
  expect(sections(threads).map(s => [s.label, s.rows.map(r => r.name)])).toEqual([["urgent", ["Amelia"]], ["clinical", ["Daniel", "Farid"]]]);
  expect(badge(threads)).toEqual({ count: 3, urgent: true });
  expect(badge(threads.slice(1))).toEqual({ count: 2, urgent: false });
  expect(badge(undefined)).toEqual({ count: 0, urgent: false });
});
