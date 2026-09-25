import { expect, test } from "bun:test";
import { newEncounter, patients } from "@/features/encounter/fixtures";
import { EMPTY_DISCHARGE, canDischarge, discharge, dischargeChecks, planFor, formatMinutes, minutesSaved } from "./model";

const amelia = patients.find(p => p.id === "SYN-1042");

test("three blockers until GL, medicines and follow-up are resolved", () => {
  const plan = planFor(amelia);
  expect(dischargeChecks(EMPTY_DISCHARGE, plan).filter(c => c.status === "blocked").map(c => c.id)).toEqual(["gl", "meds", "followup"]);
  const ready = dischargeChecks({ ...EMPTY_DISCHARGE, glReceived: true, medsConfirmed: true, followUp: "2w" }, plan);
  expect(ready.every(c => c.status === "passed")).toBe(true);
  expect(canDischarge(patients.find(p => p.incomplete))).toBe(false);
});

test("time saved is the ward's typical fit-to-door wait minus this one", () => {
  const fit = new Date(2026, 8, 25, 10, 0);
  expect(formatMinutes(minutesSaved(fit, new Date(2026, 8, 25, 10, 25)))).toBe("4 h 10 m");
  expect(formatMinutes(minutesSaved(fit, new Date(2026, 8, 25, 14, 10)))).toBe("25 m");
  expect(minutesSaved(fit, new Date(2026, 8, 25, 18, 0))).toBe(0);
});

test("discharging stamps the time and leaves follow-up tasks once", () => {
  const at = new Date(2026, 8, 25, 12, 50);
  const encounter = { ...newEncounter(), discharge: { ...EMPTY_DISCHARGE, followUp: "1w" } };
  const once = discharge(encounter, amelia, new Date(at.getTime() - 25 * 60000), at);
  expect(once.discharge.dischargedAt).toBe(at.toISOString());
  expect(once.discharge.savedMinutes).toBe(250);
  expect(once.tasks.map(t => t.owner)).toEqual(["Clinic clerk", "Billing"]);
  expect(once.tasks[0].due).toBe(new Date(2026, 9, 2).toLocaleDateString([], { day: "numeric", month: "short" }));
  expect(discharge(once, amelia, at, at).tasks).toHaveLength(2);
});
