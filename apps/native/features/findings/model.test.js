import { expect, test } from "bun:test";
import { fixtureFindings, followUpTask, withFindings } from "./model";

const seen = new Date("2026-09-26T10:00:00+08:00");

test("fixture mode shows Amelia's nodule and heart size with the server's rules, unvalidated", () => {
  const [nodule, heart] = fixtureFindings(seen);
  expect([nodule.label, nodule.riskBand, nodule.action, nodule.intervalDays, nodule.validated]).toEqual(["9 mm nodule, right upper zone", "high", "CT chest at 3 months, PET-CT or tissue sampling", 90, false]);
  expect(nodule.dueAt).toEqual(new Date("2026-12-25T10:00:00+08:00"));
  expect([heart.riskBand, heart.action, heart.source]).toEqual(["intermediate", "Echocardiogram", "fixture"]);
});

test("tracking in fixture mode makes the server's task: owner, a dated follow-up line", () => {
  const [nodule] = fixtureFindings(seen);
  expect(followUpTask(nodule)).toMatchObject({ title: "Follow up 9 mm nodule: CT chest at 3 months", owner: "Attending doctor", due: "2026-12-25" });
  expect(followUpTask({ ...nodule, dueAt: null })).toBeUndefined();
});

test("on My Day an overdue follow-up ranks red at the top and replaces its own task row; a dismissed finding leaves", () => {
  const [nodule, heart] = fixtureFindings(seen);
  const tracked = { ...nodule, status: "tracked", taskId: "t-1", owner: "Attending doctor" };
  const items = [{ id: "task-t-1", kind: "task", title: "Follow up 9 mm nodule: CT chest at 3 months", detail: "", reason: "Due 2026-12-25", tone: "routine", score: 30, open: {} },
    { id: "visit-SYN-1042", kind: "visit", title: "Amelia", detail: "", reason: "Due now", tone: "soon", score: 80, open: {} }];
  const ranked = withFindings(items, [tracked, { ...heart, status: "dismissed" }], new Date("2027-01-02T09:00:00+08:00"));
  expect(ranked.map(i => [i.id, i.tone])).toEqual([["finding-finding:visit-1042:nodule", "urgent"], ["visit-SYN-1042", "soon"]]);
  expect(ranked[0].title).toBe("Follow up 9 mm nodule: CT chest at 3 months · due 25 Dec");
});
