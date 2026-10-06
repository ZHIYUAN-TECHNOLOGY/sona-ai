import { expect, test } from "bun:test";
import { newEncounter, patients } from "@/features/encounter/fixtures";
import { wardBeds } from "@/features/ward/model";
import { flaggedItems } from "@/features/check-ins/model";
import { needsYou, pendingResults } from "./counts";
import { PENDING_RESULT, messageItems } from "./model";
import { blockedRows, needRows, shownInNeeds, taskRows, visitRows } from "./needs-you-model";

const encounters = Object.fromEntries(patients.map(p => [p.id, newEncounter()]));
const at = hhmm => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

test("needs you now: the header's patients in its order, the result with how long it has waited", () => {
  const needs = needsYou(patients, encounters, [PENDING_RESULT]);
  const { rows, total } = needRows(needs, [PENDING_RESULT], at(PENDING_RESULT.receivedAt) + 185);
  expect(total).toBe(needs.length);
  expect(rows.map(r => r.patientId)).toEqual(needs.map(n => n.id));
  expect(rows[0]).toMatchObject({ who: "Daniel Rahman", reason: "Low potassium 3.1 mmol/L · 3 h, no action · +2 more", tone: "urgent", action: "Review", go: { next: "briefing" } });
  expect(rows[1]).toMatchObject({ patientId: "SYN-1042", tone: "soon", action: "Confirm", go: { next: "medication" } });
  // Without the result, nobody's reason carries a wait.
  expect(needRows(needsYou(patients, encounters, []), [], 600).rows.every(r => !r.reason.includes("no action"))).toBe(true);
});

// Amelia, two days home, replies that she is breathless: a worse check-in with its task, as the server makes it.
const replied = new Date(2026, 9, 6, 9, 12);
const checkIn = { id: "check-in:enc:2", patientId: "SYN-1042", encounterId: "enc", day: 2, replies: [{ id: "r1", text: "Saya sesak nafas bila jalan", label: "worse", receivedAt: replied, task: { id: "t-worse", title: "Amelia: breathless after discharge", completed: false } }] };
const message = { patientId: "SYN-1042", name: "Amelia Tan", label: "urgent", reason: "Breathless", lastText: "Also I am breathless when I walk", lastAt: replied, waitingSince: replied, handled: false };

test("a worse check-in counts its patient and leads Needs you now with Call back, above the result; nobody shows twice", () => {
  const items = [...flaggedItems([checkIn]), ...messageItems([message], new Date(2026, 9, 6, 9, 30))];
  const needs = needsYou(patients, encounters, [PENDING_RESULT], items);
  // Patients, not items: Amelia's check-in, message, allergy and medicines are one row; Daniel's result the next.
  expect(needs.map(n => n.id)).toEqual(["SYN-1042", "SYN-1086"]);
  expect(new Set(needs.map(n => n.id)).size).toBe(needs.length);
  const { rows, total } = needRows(needs, [PENDING_RESULT], 600);
  expect(total).toBe(2);
  // The check-in (105) and the message (105) tie; the reply came first in the same minute, so the check-in keeps the lead by order.
  expect(rows[0]).toMatchObject({ who: "Amelia Tan", tone: "urgent", action: undefined, item: { kind: "check-in", id: "check-in-t-worse" } });
  expect(rows[0].reason).toBe("Breathless · Worse after discharge · replied 09:12 · +3 more");
  expect(rows[1]).toMatchObject({ who: "Daniel Rahman", action: "Review" });
  // Her check-in's and message's tasks are not listed again under Your tasks; her other tasks are.
  const shown = shownInNeeds(needs);
  expect([{ id: "t-worse" }, { id: "message:SYN-1042:1" }, { id: "booking:x" }, { id: "t-other" }].filter(t => !shown(t, "SYN-1042")).map(t => t.id)).toEqual(["t-other"]);
});

test("ranking: an urgent check-in leads, then worse and urgent messages (newer first), the result, a booking, medicines", () => {
  const item = (id, patientId, kind, score, at) => ({ id, kind, title: `X: ${id}`, detail: "", reason: id, tone: score >= 100 ? "urgent" : "soon", score, at, patientId, open: {} });
  const needs = needsYou([], {}, [], [item("booking", "a", "booking", 75), item("worse", "b", "check-in", 105, 1), item("message", "c", "message", 105, 2), item("urgent", "d", "check-in", 120, 0)]);
  expect(needs.map(n => n.id)).toEqual(["d", "c", "b", "a"]);
  // Someone the app has no visit for is named from the item.
  expect(needs[0]).toMatchObject({ who: "X", patient: undefined });
});

test("See all opens Results when every hidden row is a result, else Patients", () => {
  const results = ["a", "b", "c", "d"].map(patientId => ({ ...PENDING_RESULT, patientId }));
  const roster = results.map(r => ({ ...patients.find(p => p.id === "SYN-1086"), id: r.patientId }));
  const done = { historyFacts: [{ category: "allergy", value: "None", source: "", date: "", revision: 1 }], discharge: { dischargedAt: "2026-10-01" } };
  const quiet = Object.fromEntries(roster.map(p => [p.id, { ...newEncounter(), ...done }]));
  expect(needRows(needsYou(roster, quiet, results), results, 600)).toMatchObject({ total: 4, seeAll: "results" });
  expect(needRows(needsYou(roster, encounters, results.slice(0, 3)), results, 600)).toMatchObject({ seeAll: "patients" });
});

test("live: every result waiting counts, each patient's newest once", () => {
  const row = (id, patientId, hour, ack = null) => ({ id, patientId, patientName: "", test: "Potassium", value: "3", unit: "mmol/L", flag: "low", receivedAt: new Date(2026, 9, 6, hour), acknowledgedAt: ack, acknowledgedByName: null });
  const server = { tasks: [], results: [row("old", "SYN-1086", 7), row("new", "SYN-1086", 9), row("hb", "SYN-1042", 8), row("done", "SYN-1", 10, new Date())] };
  expect(pendingResults(server, {}).map(r => r.id)).toEqual(["new", "hb"]);
});

test("today's visits by time with Open; another day's are read-only; none today is no section, none another day says so", () => {
  const schedule = [{ id: "b", name: "B", initials: "B", time: "11:00", reason: "Review", incomplete: true, patientId: "SYN-1086" }, { id: "a", name: "A", initials: "A", time: "09:30", reason: "Asthma", incomplete: false, patientId: "SYN-1042" }];
  expect(visitRows(schedule, 0)).toEqual([
    { id: "a", patientId: "SYN-1042", title: "09:30 · A", reason: "Asthma", tone: "calm" },
    { id: "b", patientId: "SYN-1086", title: "11:00 · B", reason: "Review", tone: "soon" },
  ]);
  expect(visitRows([], 0)).toEqual([]);
  expect(visitRows([], 1)).toEqual([]);
});

test("each section shows at most three rows and counts them all; none is empty", () => {
  const many = needsYou(Array.from({ length: 5 }, (_, i) => ({ ...patients.find(p => p.id === "SYN-1086"), id: `p${i}`, name: `P ${i}` })), {}, []);
  expect(needRows(many, [], 600)).toMatchObject({ total: 5, rows: { length: 3 }, seeAll: "patients" });
  expect(needRows([], [], 600)).toEqual({ rows: [], total: 0, seeAll: "results" });
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
