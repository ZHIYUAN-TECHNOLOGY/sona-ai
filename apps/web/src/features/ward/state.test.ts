// @ts-expect-error apps/web has no bun types yet (no new dependencies in this change); add @types/bun and drop this line.
import { expect, test } from "bun:test";

import { filterTasks, isOverdue } from "./state";

const tasks = [
  { owner: "Dr Lim", due: "2026-10-01", completed: false },
  { owner: "Dr Lim", due: "2026-10-01", completed: true },
  { owner: "Nurse", due: null, completed: false },
  { owner: "Nurse", due: "2026-10-06", completed: false },
];

test("overdue is open, dated and past; due today is not overdue", () => {
  expect(tasks.map(t => isOverdue(t, "2026-10-06"))).toEqual([true, false, false, false]);
});

test("filters", () => {
  expect(filterTasks(tasks, "all", "Dr Lim", "2026-10-06")).toHaveLength(4);
  expect(filterTasks(tasks, "mine", "Dr Lim", "2026-10-06")).toHaveLength(2);
  expect(filterTasks(tasks, "overdue", "Dr Lim", "2026-10-06")).toHaveLength(1);
});
