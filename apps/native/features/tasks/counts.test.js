import { expect, it, test } from "bun:test";
import { dueGroup, taskCounts } from "./counts";

it("counts open, overdue and due-today follow-ups, ignoring completed and worded dates", () => {
  const today = new Date(2026, 8, 29);
  const tasks = [
    { due: "2026-09-28", completed: false },
    { due: "2026-09-01", completed: false },
    { due: "2026-09-29", completed: false },
    { due: "Today", completed: false },
    { due: "13 Oct", completed: false },
    { due: "2026-09-30", completed: false },
    { due: "2026-09-20", completed: true },
  ];
  expect(taskCounts(tasks, today)).toEqual({ open: 6, overdue: 2, dueToday: 2 });
  expect(taskCounts([], today)).toEqual({ open: 0, overdue: 0, dueToday: 0 });
});

test("open tasks group by when they're due: overdue, today, this week, later", () => {
  const today = new Date(2026, 8, 29);
  expect(["2026-09-28", "Today", "2026-09-29", "2026-10-06", "2026-10-07", "13 Oct"].map(d => dueGroup(d, today))).toEqual(["overdue", "today", "today", "week", "later", "later"]);
});
