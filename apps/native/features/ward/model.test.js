import { expect, test } from "bun:test";
import { newEncounter, patients } from "@/features/encounter/fixtures";
import { EMPTY_DISCHARGE } from "@/features/discharge/model";
import { huddle, wardBeds, wardSummary } from "./model";

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
