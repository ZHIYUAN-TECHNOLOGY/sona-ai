import { expect, test } from "bun:test";
import { newEncounter, patients } from "@/features/encounter/fixtures";
import { wardBeds } from "@/features/ward/model";
import { needsYou } from "./counts";
import { PENDING_RESULT } from "./model";
import { blockedRows, needRows, taskRows } from "./needs-you-model";

const encounters = Object.fromEntries(patients.map(p => [p.id, newEncounter()]));
const at = hhmm => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

test("needs you now: the header's patients in its order, the result with how long it has waited", () => {
  const needs = needsYou(patients, encounters, PENDING_RESULT);
  const { rows, total } = needRows(needs, PENDING_RESULT, at(PENDING_RESULT.receivedAt) + 185);
  expect(total).toBe(needs.length);
  expect(rows.map(r => r.patientId)).toEqual(needs.map(n => n.patient.id));
  expect(rows[0]).toMatchObject({ who: "Daniel Rahman", reason: "Low potassium 3.1 mmol/L · 3 h, no action", tone: "urgent", action: "Review", go: { next: "briefing" } });
  expect(rows[1]).toMatchObject({ patientId: "SYN-1042", tone: "soon", action: "Confirm", go: { next: "medication" } });
  // Without the result, nobody's reason carries a wait.
  expect(needRows(needsYou(patients, encounters, undefined), undefined, 600).rows.every(r => !r.reason.includes("no action"))).toBe(true);
});

test("each section shows at most three rows and counts them all; none is empty", () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ patient: { ...patients[0], id: `p${i}`, name: `P ${i}` }, flag: { label: "History incomplete", tone: "caution", go: { next: "reasoning" } } }));
  expect(needRows(many, undefined, 600)).toMatchObject({ total: 5, rows: { length: 3 } });
  expect(needRows([], undefined, 600)).toEqual({ rows: [], total: 0 });
  expect(blockedRows([], {}, () => true)).toEqual({ rows: [], total: 0 });
  expect(taskRows([], undefined, new Date())).toEqual({ rows: [], total: 0 });
});

test("discharges blocked: the ward's blocked beds, unowned first then longest waiting, each with its one move", () => {
  const beds = wardBeds(patients, encounters);
  const blocked = blockedRows(beds, {}, id => patients.some(p => p.id === id));
  expect(blocked.total).toBe(3);
  expect(blocked.rows.map(r => r.bed)).toEqual(["Bed 2", "Bed 14", "Bed 6"]);
  expect(blocked.rows[0]).toMatchObject({ who: "Bed 2 · Nurul", reason: "Final guarantee letter +1 · no owner · 5 h waiting", action: "assign", suggested: "Billing", blockerId: "b2-gl" });
  // Amelia's letter is hers to open; a bed whose blockers all have owners opens the bed and says who is on it.
  expect(blocked.rows[2]).toMatchObject({ action: "letter", patientId: "SYN-1042" });
  const owned = blockedRows(beds, { "b2-gl": "Billing", "b2-result": "Nurse" }, () => false);
  expect(owned.rows.at(-1)).toMatchObject({ bed: "Bed 2", reason: "Final guarantee letter +1 · Billing on it · 5 h waiting", action: "bed" });
  // One owner of two: the open one shows.
  expect(blockedRows(beds, { "b2-gl": "Billing" }, () => false).rows.find(r => r.bed === "Bed 2")).toMatchObject({ blockerId: "b2-result", suggested: "Nurse" });
});

test("your tasks: the handover first, then open tasks soonest due, completed ones left out", () => {
  const today = new Date(2026, 9, 6, 9);
  const task = (id, due, completed = false) => ({ id, title: id, owner: "Dr Lim", due, completed });
  const amelia = patients.find(p => p.id === "SYN-1042");
  const rows = taskRows([task("later", "2026-10-13"), task("late", "2026-10-05"), task("done", "2026-10-06", true), task("today", "2026-10-06")].map(t => ({ task: t, patient: amelia })), 3, today);
  expect(rows.total).toBe(4);
  expect(rows.rows.map(r => r.id)).toEqual(["handover", "late", "today"]);
  expect(rows.rows[0]).toMatchObject({ title: "Hand over 3 patients", kind: "handover" });
  expect(rows.rows[1]).toMatchObject({ reason: "Amelia · Overdue · Mon 5 Oct", tone: "soon" });
  expect(rows.rows[2].reason).toBe("Amelia · Due Today");
  expect(taskRows([], 0, today).total).toBe(0);
});
