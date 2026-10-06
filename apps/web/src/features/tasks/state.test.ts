// @ts-ignore -- apps/web has no Bun types installed; drop this line once @types/bun is a devDependency.
import { expect, test } from "bun:test";

import { dueLabel, groupTasks, matchesTask, sourceOf } from "./state";

const task = (over: Partial<Parameters<typeof matchesTask>[0]>) => ({ title: "Call family", owner: "Dr Lim", due: null, completed: false, encounterId: null, kind: "followup", ...over });

test("tasks group by state against today", () => {
  const g = groupTasks([task({ due: "2026-10-05" }), task({ due: "2026-10-06", owner: "Nurse Tan" }), task({ due: "2026-10-01", completed: true })], "Dr Lim", "2026-10-06");
  expect([g.open.length, g.mine.length, g.overdue.length, g.dueToday.length, g.done.length, g.all.length]).toEqual([2, 1, 1, 1, 1, 3]);
});

test("search, source and due date read in plain words", () => {
  expect(matchesTask(task({ kind: "check-in" }), "check-in")).toBe(true);
  expect(matchesTask(task({}), "xray")).toBe(false);
  expect(sourceOf("unknown").label).toBe("Added by the care team");
  expect(dueLabel("2026-10-06", "2026-10-06")).toBe("Today");
  expect(dueLabel("2026-10-03", "2026-10-06")).toBe("Sat 3 Oct");
});
