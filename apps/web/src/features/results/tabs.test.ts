// @ts-expect-error apps/web has no bun types yet, as in triage.test.ts
import { expect, test } from "bun:test";
import { inTab, summary } from "./tabs";

const row = (id: string, o: object) => ({
  id, patientId: "p1", test: "K", value: "5", unit: null, flag: null, critical: false,
  receivedAt: "2026-10-01", acknowledgedAt: null, ...o,
});

test("tabs split waiting from acknowledged, and the summary counts only waiting results", () => {
  const rows = [
    row("a", { critical: true }), row("b", { flag: "High", patientId: "p2" }),
    row("c", { flag: "Normal" }), row("d", { flag: "High", acknowledgedAt: "2026-10-02" }),
  ];
  expect(rows.filter(inTab("action")).map(r => r.id)).toEqual(["a", "b"]);
  expect(rows.filter(inTab("new")).map(r => r.id)).toEqual(["a", "b", "c"]);
  expect(rows.filter(inTab("acknowledged")).map(r => r.id)).toEqual(["d"]);
  expect(summary(rows)).toEqual({ fresh: 3, patients: 2, critical: 1, review: 1 });
});
