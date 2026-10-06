// @ts-expect-error apps/web has no bun types yet (no new dependencies in this change); add @types/bun and drop this line.
import { expect, test } from "bun:test";

import { byTriage, counts, matches, seriesFor, type TriageRow } from "./triage";

const row = (over: Partial<TriageRow>): TriageRow => ({
  id: "r", patientId: "p1", test: "Potassium", value: "4.1", unit: "mmol/L", flag: null, critical: false,
  receivedAt: "2026-10-06T02:00:00Z", acknowledgedAt: null, ...over,
});

const rows = [
  row({ id: "done", acknowledgedAt: "2026-10-06T03:00:00Z", flag: "critical high", critical: true }),
  row({ id: "plain-old", receivedAt: "2026-10-05T02:00:00Z" }),
  row({ id: "plain-new" }),
  row({ id: "critical", flag: "critical low", critical: true, value: "2.8", receivedAt: "2026-10-04T02:00:00Z" }),
  row({ id: "culture", patientId: "p2", test: "Culture", value: "No growth", unit: null }),
];

test("critical first, then newest, acknowledged last", () => {
  expect([...rows].sort(byTriage).map(r => r.id)).toEqual(["critical", "plain-new", "culture", "plain-old", "done"]);
});

test("filters and counts", () => {
  expect(rows.filter(matches("abnormal")).map(r => r.id)).toEqual(["done", "critical"]);
  expect(rows.filter(matches("unacknowledged")).length).toBe(4);
  expect(counts(rows, new Date("2026-10-06T03:00:00Z"))).toEqual({ mustNotMiss: 1, waiting: 3, acknowledgedToday: 1 });
});

test("a series holds only the patient's real numeric values of that test, oldest first", () => {
  expect(seriesFor(rows, rows[3]!).map(p => p.y)).toEqual([2.8, 4.1, 4.1, 4.1]);
  expect(seriesFor(rows, rows[4]!)).toEqual([]);
});
