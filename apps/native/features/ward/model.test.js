import { expect, test } from "bun:test";
import { newEncounter, patients } from "@/features/encounter/fixtures";
import { EMPTY_DISCHARGE } from "@/features/discharge/model";
import { soonest } from "@/features/ask/answers";
import { unownedBlocked } from "@/features/day/model";
import { asFilter, bedBar, bedRow, defaultFilter, emptyLine, filterBeds, filterSegments, huddle, ownerReceipt, wardBeds, wardSummary } from "./model";

test("the bed bar has one segment per bed, blocked first, and a legend that adds up", () => {
  const bar = bedBar(wardBeds(patients, {}));
  expect(bar.segments).toEqual(["blocked", "blocked", "blocked", "fit", "watch", "watch", "other", "other"]);
  expect(bar.legend.map(l => [l.label, l.count])).toEqual([["blocked", 3], ["fit to go", 1], ["watch", 2], ["other", 2]]);
  expect(bar.label).toBe("8 beds: 3 blocked, 1 fit to go, 2 watch, 2 other");
  // A freed bed is "other"; empty groups drop out of the legend.
  expect(bedBar([{ bed: "Bed 6", status: "free", predicted: "", blockers: [] }]).legend).toEqual([{ kind: "other", label: "other", count: 1 }]);
});

test("fit beds lead and the demo bed carries its live blockers", () => {
  const beds = wardBeds(patients, {});
  expect(beds[0].status).toBe("fit");
  const six = beds.find(b => b.bed === "Bed 6");
  expect(six.blockers.map(b => b.kind)).toEqual(["gl", "pharmacy", "booking"]);
  expect(wardSummary(beds)).toEqual({ beds: 8, fit: 4, blocked: 3, bedHours: 9 });
});

test("resolving the discharge clears bed 6, and discharging frees it", () => {
  const ready = { ...newEncounter(), discharge: { ...EMPTY_DISCHARGE, glReceived: true, medsConfirmed: true, followUp: "2w" } };
  expect(wardBeds(patients, { "SYN-1042": ready }).find(b => b.bed === "Bed 6").blockers).toEqual([]);
  const gone = { ...ready, discharge: { ...ready.discharge, dischargedAt: "2026-09-26T04:00:00.000Z" } };
  const beds = wardBeds(patients, { "SYN-1042": gone });
  expect(beds.find(b => b.bed === "Bed 6").status).toBe("free");
  expect(wardSummary(beds).fit).toBe(3);
});

test("the filter opens on blocked, lists only its beds, and says something calm when empty", () => {
  const beds = wardBeds(patients, {});
  expect(defaultFilter(beds)).toBe("blocked");
  expect(filterSegments(beds, "blocked").map(s => `${s.label} ${s.count}`)).toEqual(["All 8", "Blocked 3", "Fit to go 1", "Watch 2"]);
  expect(filterBeds(beds, "blocked").map(b => b.bed)).toEqual(["Bed 6", "Bed 2", "Bed 14"]);
  expect(filterBeds(beds, "all").map(b => bedRow(b).kind)).toEqual(["blocked", "blocked", "blocked", "fit", "watch", "watch", "other", "other"]);
  expect(bedRow(beds.find(b => b.bed === "Bed 2"))).toEqual({ kind: "blocked", title: "Bed 2 · Nurul", when: "Out 11:00", flag: "2 blockers" });
  expect(bedRow(beds.find(b => b.bed === "Bed 10")).title).toBe("Bed 10 · No patient");

  // Nothing blocked: all is the default, the blocked segment hides unless picked, and its empty line points at the fit bed.
  const clear = beds.map(b => ({ ...b, blockers: b.status === "fit" ? [] : b.blockers }));
  expect(defaultFilter(clear)).toBe("all");
  expect(filterSegments(clear, "all").map(s => s.key)).toEqual(["all", "fit", "watch"]);
  expect(filterSegments(clear, "blocked").map(s => s.key)).toEqual(["all", "blocked", "fit", "watch"]);
  expect(filterBeds(clear, "blocked")).toEqual([]);
  expect(emptyLine(clear, "blocked")).toBe("Nothing blocked. 4 beds are fit to go.");
  expect(emptyLine(beds.filter(b => b.bed !== "Bed 2" && b.bed !== "Bed 14" && b.bed !== "Bed 6"), "blocked")).toBe("Nothing blocked. 1 bed is fit to go.");
  expect([asFilter("watch"), asFilter("other"), asFilter("nope"), asFilter(undefined)]).toEqual(["watch", "all", undefined, undefined]);
});

test("the huddle counts blockers without an owner", () => {
  const beds = wardBeds(patients, {});
  expect(huddle(beds, {})[2]).toBe("7 blockers have no owner yet.");
  expect(huddle(beds, { "b6-gl": "Billing" })[2]).toBe("6 blockers have no owner yet.");
});

test("assigning says who was told and when; demo mode says nothing was sent", () => {
  const at = new Date(2026, 8, 30, 14, 5);
  expect(ownerReceipt("Billing", at, false)).toBe("Billing notified · 14:05");
  expect(ownerReceipt("Porter", at, true)).toBe("Porter notified · 14:05 · simulated, nothing sent");
  expect(ownerReceipt(undefined, at, false)).toBe("Owner cleared · 14:05");
});

test("every count of blocked beds is the list it opens: the filter, the summary, the huddle, Today's unowned beds and Sona's answer", () => {
  // Where the copies of the rule used to part: a bed marked fit with a blocker but no patient, and a watch bed with one.
  const nameless = { bed: "Bed 3", status: "fit", predicted: "Once cleared", blockers: [{ id: "b3-gl", kind: "gl", label: "Final guarantee letter", detail: "Requested" }] };
  const watched = { bed: "Bed 5", name: "Ali Hassan", status: "watch", predicted: "Tomorrow", blockers: [{ id: "b5-renal", kind: "result", label: "Renal function", detail: "Due 06:00" }] };
  const beds = [...wardBeds(patients, {}), nameless, watched];
  const blocked = filterBeds(beds, "blocked").map(b => b.bed);
  for (const s of filterSegments(beds, "all")) expect(filterBeds(beds, s.key)).toHaveLength(s.count);
  expect(blocked).toEqual(["Bed 6", "Bed 2", "Bed 14"]);
  expect(wardSummary(beds).blocked).toBe(blocked.length);
  expect(huddle(beds, {})).toEqual(["4 fit to go, 3 still blocked, about 9 bed-hours waiting.", "Start with Bed 6: final guarantee letter, take-home medicines, follow-up booking.", "7 blockers have no owner yet."]);
  expect(unownedBlocked(beds, {}).map(r => r.bed).sort()).toEqual([...blocked].sort());
  expect(Object.values(soonest(beds).spec.elements).find(e => e.type === "AskLead").props.text).toBe("1 bed can free now; 3 discharges are blocked, about 9 bed-hours waiting.");
});
