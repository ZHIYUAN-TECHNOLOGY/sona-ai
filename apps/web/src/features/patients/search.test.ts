// @ts-expect-error apps/web has no bun types yet (same as src/lib/wav.test.ts); add @types/bun and drop this line.
import { expect, test } from "bun:test";

import { filterPatients } from "./search";

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
