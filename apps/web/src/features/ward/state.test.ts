// @ts-expect-error apps/web has no bun types yet (no new dependencies in this change); add @types/bun and drop this line.
import { expect, test } from "bun:test";

import { filterTasks, freeBy, isOverdue, rankBeds, unownedOn } from "./state";

const tasks = [
  { owner: "Dr Lim", due: "2026-10-01", completed: false },
  { owner: "Dr Lim", due: "2026-10-01", completed: true },
  { owner: "Nurse", due: null, completed: false },
  { owner: "Nurse", due: "2026-10-06", completed: false },
];

test("overdue is open, dated and past; due today is not overdue", () => {
  expect(tasks.map(t => isOverdue(t, "2026-10-06"))).toEqual([true, false, false, false]);
});

test("beds rank by need: no owner, blocked, watched, the rest; ties keep their order", () => {
  const bed = (id: string, status: string, ...blockers: string[]) => ({ id, status, blockers: blockers.map(b => ({ id: b })) });
  const beds = [bed("calm", "stable"), bed("watched", "watch"), bed("owned", "fit", "x"), bed("half", "fit", "x", "y"), bed("open", "watch", "z")];
  const owners = new Map([["x", "Pharmacy"]]);
  expect(rankBeds(beds, owners).map(b => b.id)).toEqual(["half", "open", "owned", "watched", "calm"]);
  expect(beds.map(b => unownedOn(b, owners))).toEqual([0, 0, 0, 1, 1]);
});

test("a forecast reads as a phrase", () => {
  expect(["11:00", "Once cleared", "Tomorrow", "Awaiting rehab"].map(freeBy)).toEqual(["Discharge 11:00", "Discharge once cleared", "Discharge tomorrow", "Awaiting rehab"]);
});

test("filters", () => {
  expect(filterTasks(tasks, "all", "Dr Lim", "2026-10-06")).toHaveLength(4);
  expect(filterTasks(tasks, "mine", "Dr Lim", "2026-10-06")).toHaveLength(2);
  expect(filterTasks(tasks, "overdue", "Dr Lim", "2026-10-06")).toHaveLength(1);
});
