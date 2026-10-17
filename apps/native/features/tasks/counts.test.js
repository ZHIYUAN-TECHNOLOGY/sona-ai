import { expect, it, test } from "bun:test";
import { dueGroup, rankByDue, taskCounts } from "./counts";

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

test("across visits, open tasks rank in one list: overdue, today, this week, later, soonest first, whoever the patient", () => {
  const today = new Date(2026, 8, 29);
  const row = (patientId, id, due, completed = false) => ({ patientId, task: { id, due, completed } });
  const rows = [row("amelia", "a1", "2026-10-02"), row("daniel", "d1", "2026-09-27"), row("amelia", "a2", "Today"), row("daniel", "d2", "2026-09-30"), row("amelia", "a3", "13 Oct"), row("daniel", "d3", "2026-09-20", true), row("amelia", "a4", "2026-09-28")];
  expect(rankByDue(rows, today).map(g => [g.title, g.rows.map(r => r.task.id)])).toEqual([["Overdue", ["d1", "a4"]], ["Today", ["a2"]], ["This week", ["d2", "a1"]], ["Later", ["a3"]]]);
  expect(rankByDue([row("x", "done", "2026-09-28", true)], today)).toEqual([]);
});
