import { expect, test } from "bun:test";
import { newEncounter, patients } from "@/features/encounter/fixtures";
import { EMPTY_DISCHARGE } from "@/features/discharge/model";
import { bedBar, huddle, wardBeds, wardSummary } from "./model";

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

test("the huddle counts blockers without an owner", () => {
  const beds = wardBeds(patients, {});
  expect(huddle(beds, {})[2]).toBe("7 blockers have no owner yet.");
  expect(huddle(beds, { "b6-gl": "Billing" })[2]).toBe("6 blockers have no owner yet.");
});
