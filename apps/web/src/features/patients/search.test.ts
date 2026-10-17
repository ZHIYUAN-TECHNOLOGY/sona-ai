// @ts-expect-error apps/web has no bun types yet (same as src/lib/wav.test.ts); add @types/bun and drop this line.
import { expect, test } from "bun:test";

import { filterPatients, rankPatients } from "./search";

const rows = [
  { id: "p1", name: "Aminah Binti Ali", subtitle: "Ward 4A", complaint: "Cough" },
  { id: "p2", name: "Tan Wei", subtitle: "Clinic 2", complaint: "Chest pain" },
];

test("filterPatients matches every typed word across name, place and complaint", () => {
  expect(filterPatients(rows, "")).toEqual(rows);
  expect(filterPatients(rows, "  ")).toEqual(rows);
  expect(filterPatients(rows, "aminah 4a").map((r) => r.id)).toEqual(["p1"]);
  expect(filterPatients(rows, "CHEST").map((r) => r.id)).toEqual(["p2"]);
  expect(filterPatients(rows, "tan cough")).toEqual([]);
});

test("rankPatients puts watch first, then fit by longest wait, then incomplete records, then the rest", () => {
  const list = [
    { id: "stable", ward: { status: "stable" } },
    { id: "none" },
    { id: "fit-2h", ward: { status: "fit", waitingHours: 2 } },
    { id: "incomplete", incomplete: true },
    { id: "fit-9h", ward: { status: "fit", waitingHours: 9 } },
    { id: "watch", ward: { status: "watch" } },
  ];
  expect(rankPatients(list).map((r) => r.id)).toEqual(["watch", "fit-9h", "fit-2h", "incomplete", "stable", "none"]);
  expect(list[0]!.id).toBe("stable");
});
