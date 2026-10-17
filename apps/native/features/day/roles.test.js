import { expect, test } from "bun:test";
import { can } from "@sona-ai/api/roles";
import { WARD_FIXTURE } from "@/features/ward/model";
import { ownersOf, unownedBlocked, usableKeys } from "./model";


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
