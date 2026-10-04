import { expect, test } from "bun:test";
import { flaggedItems, reportItems } from "./model";

const at = new Date("2026-10-04T06:02:00Z");
const clock = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
const task = over => ({ id: "t-report", kind: "check-in", title: "Amelia: chest pain after discharge", completed: false, encounterId: "enc-1", createdAt: at, ...over });
// A day-2 check-in whose reply flagged its own task (the server's shape).
const replied = [{ id: "check-in:enc-1:2", patientId: "SYN-1042", encounterId: "enc-1", day: 2, language: "en", message: "", dueAt: at, sentAt: at,
  replies: [{ id: "r1", text: "my fever is back", label: "worse", source: "fixture", receivedAt: at, task: { id: "t-reply", title: "Amelia: fever returned after discharge", completed: false } }] }];
const patientOf = id => ({ "enc-1": "SYN-1042" })[id];

test("a problem told to Sona Care is a red flagged row from its task, with the row ID Book in reads", () => {
  expect(reportItems([task()], [], patientOf)).toEqual([{ id: "check-in-t-report", kind: "check-in", title: "Amelia: chest pain after discharge", detail: "Told to Sona Care",
    reason: `Urgent · reported ${clock}`, tone: "urgent", score: 120, at: at.getTime(), patientId: "SYN-1042", open: {} }]);
  // Not an emergency sign: still red, ranked as worse; a visit the app does not know still lists (Book in needs only the task).
  expect(reportItems([task({ title: "Amelia: cough", encounterId: "enc-9" })], [], patientOf)[0]).toMatchObject({ reason: `Worse · reported ${clock}`, score: 105, patientId: undefined });
});

test("a task a reply flagged is not listed twice, and other kinds and done tasks are not flags", () => {
  const tasks = [task(), task({ id: "t-reply", title: "Amelia: fever returned after discharge" }), task({ id: "t-other", kind: "followup" }), task({ id: "t-done", completed: true })];
  const rows = [...flaggedItems(replied), ...reportItems(tasks, replied, patientOf)];
  expect(rows.map(r => r.id)).toEqual(["check-in-t-reply", "check-in-t-report"]);
  // Just booked in: the row stays while it offers the same-visit follow-ups.
  expect(reportItems(tasks, replied, patientOf, ["t-done"]).map(r => r.id)).toEqual(["check-in-t-report", "check-in-t-done"]);
});
