// @ts-ignore -- apps/web has no Bun types installed; drop this line once @types/bun is a devDependency.
import { expect, test } from "bun:test";

import { dueLabel, groupTasks, matchesTask, rankTasks, sourceOf } from "./state";

const task = (over: Partial<Parameters<typeof matchesTask>[0]>) => ({ title: "Call family", owner: "Dr Lim", due: null, completed: false, encounterId: null, kind: "followup", ...over });

test("tasks group by state against today", () => {
  const g = groupTasks([task({ due: "2026-10-05" }), task({ due: "2026-10-06", owner: "Nurse Tan" }), task({ due: "2026-10-01", completed: true })], "Dr Lim", "2026-10-06");
  expect([g.open.length, g.mine.length, g.overdue.length, g.dueToday.length, g.done.length, g.all.length]).toEqual([2, 1, 1, 1, 1, 3]);
});

test("tasks rank overdue first, undated after dated, done last", () => {
  const ranked = rankTasks([task({ title: "undated" }), task({ title: "done", due: "2026-10-01", completed: true }), task({ title: "today", due: "2026-10-06" }), task({ title: "overdue", due: "2026-10-03" })]);
  expect(ranked.map(t => t.title)).toEqual(["overdue", "today", "undated", "done"]);
});

test("a due written in words is neither overdue nor ranked before dated tasks", () => {
  const written = task({ title: "written", due: "1 day after discharge" });
  expect(groupTasks([written], "Dr Lim", "2026-10-06").overdue).toEqual([]);
  expect(rankTasks([written, task({ title: "dated", due: "2026-10-09" })]).map(t => t.title)).toEqual(["dated", "written"]);
});

test("search, source and due date read in plain words", () => {
  expect(matchesTask(task({ kind: "check-in" }), "check-in")).toBe(true);
  expect(matchesTask(task({}), "xray")).toBe(false);
  expect(sourceOf("unknown").label).toBe("Added by the care team");
  expect(dueLabel("2026-10-06", "2026-10-06")).toBe("Today");
  expect(dueLabel("2026-10-03", "2026-10-06")).toBe("Sat 3 Oct");
  expect(dueLabel("tomorrow", "2026-10-06")).toBe("tomorrow");
});
