import { expect, test } from "bun:test";
import { can } from "@sona-ai/api/roles";
import { WARD_FIXTURE } from "@/features/ward/model";
import { canSnooze, ownersOf, SNOOZE_MS, snooze, splitSnoozed, unownedBlocked, usableKeys } from "./model";

const row = (id, tone) => ({ id, kind: "task", title: id, detail: "", reason: "", tone, score: 30, open: {} });

test("a snoozed row sleeps an hour, then wakes by itself on the next minute tick", () => {
  const task = row("task-1", "routine"), visit = row("visit-1", "soon");
  const at = Date.parse("2026-09-30T02:00:00Z");
  const snoozed = snooze({}, task, at);
  expect(snoozed).toEqual({ "task-1": at + SNOOZE_MS });
  const asleep = splitSnoozed([task, visit], snoozed, at + 59 * 60_000);
  expect(asleep.active.map(i => i.id)).toEqual(["visit-1"]);
  expect(asleep.later).toEqual([{ item: task, wakes: at + SNOOZE_MS }]);
  expect(splitSnoozed([task, visit], snoozed, at + SNOOZE_MS).active.map(i => i.id)).toEqual(["task-1", "visit-1"]);
});

test("urgent rows can't be snoozed, and one that turned urgent while asleep comes straight back", () => {
  const urgent = row("message-SYN-1", "urgent");
  expect(canSnooze(urgent)).toBe(false);
  expect(snooze({}, urgent, 0)).toEqual({});
  const at = 1_000;
  expect(splitSnoozed([urgent], { "message-SYN-1": at + SNOOZE_MS }, at)).toEqual({ active: [urgent], later: [] });
});

test("a bed manager keeps only the keys whose pages they can read; doctors and nurses keep every key", () => {
  const keys = ["patients", "results", "messages", "handover", "ward"].map(key => ({ key }));
  const usable = role => usableKeys(keys, path => can(role, path)).map(k => k.key);
  expect(usable("bed-manager")).toEqual(["ward"]);
  expect(usable("doctor")).toEqual(["patients", "results", "messages", "handover", "ward"]);
  expect(usable("nurse")).toEqual(["patients", "results", "messages", "handover", "ward"]);
});

test("a bed manager's Today lists blocked discharges with a blocker nobody owns, each with its suggested team, most bed-hours first", () => {
  expect(unownedBlocked(WARD_FIXTURE, {})).toEqual([
    { bed: "Bed 2", name: "Nurul Huda", hours: 5, blockers: [{ id: "b2-gl", label: "Final guarantee letter", suggested: "Billing" }, { id: "b2-result", label: "Urine culture sensitivities", suggested: "Nurse" }] },
    { bed: "Bed 14", name: "Lim Wei Jie", hours: 3, blockers: [{ id: "b14-pharm", label: "Take-home analgesia", suggested: "Pharmacy" }, { id: "b14-ride", label: "Ride home", suggested: "Porter" }] },
  ]);
  // Owners come from the server's blocker-owner tasks; a bed whose blockers are all owned leaves the list.
  const owners = ownersOf([
    { kind: "blocker-owner", sourceId: "b14-pharm", owner: "Pharmacy" }, { kind: "blocker-owner", sourceId: "b14-ride", owner: "Porter" },
    { kind: "follow-up", sourceId: "b2-gl", owner: "Dr Lim" }, { kind: "blocker-owner", sourceId: null, owner: "Billing" },
  ]);
  expect(owners).toEqual({ "b14-pharm": "Pharmacy", "b14-ride": "Porter" });
  expect(unownedBlocked(WARD_FIXTURE, owners).map(r => r.bed)).toEqual(["Bed 2"]);
  // Watch and stable beds (not fit to go) are never listed, even with blockers.
  expect(unownedBlocked(WARD_FIXTURE, {}).some(r => r.bed === "Bed 9" || r.bed === "Bed 4")).toBe(false);
});
