import { expect, test } from "bun:test";
import { newEncounter, patients } from "@/features/encounter/fixtures";
import { fixtureCheckIns, scheduleLine } from "@/features/check-ins/model";
import { EMPTY_DISCHARGE, canDischarge, checkInDaysFor, discharge, dischargeChecks, fitAtOf, followUpsOf, planFor, formatMinutes, minutesSaved } from "./model";

const amelia = patients.find(p => p.id === "SYN-1042");

test("three blockers until GL, medicines and follow-up are resolved", () => {
  const plan = planFor(amelia);
  expect(dischargeChecks(EMPTY_DISCHARGE, plan).filter(c => c.status === "blocked").map(c => c.id)).toEqual(["gl", "meds", "followup"]);
  const ready = dischargeChecks({ ...EMPTY_DISCHARGE, glReceived: true, medsConfirmed: true, followUp: "2w" }, plan);
  expect(ready.every(c => c.status === "passed")).toBe(true);
  expect(canDischarge(patients.find(p => p.incomplete))).toBe(false);
});

test("the plan is read from the record, not written for one patient: the charted take-home list, and only the checks its visit's facts can answer", () => {
  const plan = planFor(amelia);
  expect(plan.meds).toEqual(amelia.takeHome);
  // The sample's visit holds a guarantee letter and nothing else: no chart, no model's draft, so neither is claimed as passed.
  expect(dischargeChecks(EMPTY_DISCHARGE, plan).map(c => c.id)).toEqual(["gl", "meds", "followup"]);
  // Connected, the server's read of the visit's rows adds what it found: a stable chart and a stored draft pass, a fever blocks.
  const at = "2026-09-26T00:00:00.000Z", vitals = [{ kind: "temperature", value: 36.9, unit: "°C", at }, { kind: "pulse", value: 84, unit: "bpm", at }];
  const served = { ...plan, visit: { ...plan.visit, fitAt: at, vitals, drafted: true } };
  expect(dischargeChecks(EMPTY_DISCHARGE, served).map(c => [c.id, c.status])).toEqual([["observations", "passed"], ["summary", "passed"], ["gl", "blocked"], ["meds", "blocked"], ["followup", "blocked"]]);
  const febrile = { ...served, visit: { ...served.visit, vitals: [{ ...vitals[0], value: 38.5 }] } };
  expect(dischargeChecks(EMPTY_DISCHARGE, febrile)[0]).toMatchObject({ id: "observations", status: "blocked", detail: "Temp 38.5 °C" });
  // A pending result or a ride the ward is waiting on holds the discharge here as it does on the server.
  expect(dischargeChecks(EMPTY_DISCHARGE, plan, [], [{ id: "result-1", label: "Urine culture sensitivities", detail: "Pending" }]).at(-1)).toMatchObject({ label: "Urine culture sensitivities", status: "blocked" });
  // A stay with no guarantee letter (self-pay) has no letter check and leaves no claim task; a bed nobody marked fit counts no minutes saved.
  const selfPay = { ...amelia, visit: {} };
  expect(dischargeChecks(EMPTY_DISCHARGE, planFor(selfPay)).map(c => c.id)).toEqual(["meds", "followup"]);
  const done = discharge({ ...newEncounter(), discharge: { ...EMPTY_DISCHARGE, followUp: "2w" } }, selfPay, undefined, new Date(2026, 8, 25, 12, 0));
  expect([done.tasks.map(t => t.owner), done.discharge.savedMinutes]).toEqual([["Clinic clerk"], 0]);
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

test("discharging keeps the chosen check-in days, else the condition's, and the fixture check-ins follow them", () => {
  const at = new Date("2026-09-26T15:40:00+08:00");
  const encounter = { ...newEncounter(), discharge: { ...EMPTY_DISCHARGE, followUp: "2w" } };
  expect(discharge(encounter, amelia, at, at).discharge.checkInDays).toEqual([2, 7]);
  const chosen = discharge({ ...encounter, discharge: { ...encounter.discharge, checkInDays: [1, 3, 14] } }, amelia, at, at);
  expect(fixtureCheckIns(amelia, chosen.discharge, {}, at).map(c => c.day)).toEqual([1, 3, 14]);
  expect(scheduleLine(at, [1, 3])).toBe("Day 1 Sun 27 Sep · Day 3 Tue 29 Sep");
});

test("a reopened receipt reads what was stored and made: when the patient was fit, the follow-ups on the visit and the check-ins scheduled", () => {
  const fit = new Date(2026, 8, 25, 10, 0), at = new Date(2026, 8, 25, 10, 25);
  const done = discharge({ ...newEncounter(), discharge: { ...EMPTY_DISCHARGE, followUp: "2w" } }, amelia, fit, at);
  // Fit comes back from the stored saving, whenever the receipt reopens; with nothing saved there is nothing to read.
  expect(fitAtOf(done.discharge)).toEqual(fit);
  expect(fitAtOf({ ...done.discharge, savedMinutes: 0 })).toBeUndefined();
  expect(fitAtOf(EMPTY_DISCHARGE)).toBeUndefined();
  // Only the discharge's own tasks count: this device's copies by ID, the server's by title; none when the visit has none.
  const plan = planFor(amelia);
  const other = { id: "t-xray", title: "Repeat chest X-ray in 6 weeks", owner: "Clinic clerk", due: "", completed: false };
  expect(followUpsOf([...done.tasks, other], amelia, done.discharge, plan)).toHaveLength(2);
  expect(followUpsOf([{ ...done.tasks[0], id: "server-row-1" }, other], amelia, done.discharge, plan)).toHaveLength(1);
  expect(followUpsOf([], amelia, done.discharge, plan)).toHaveLength(0);
  // The check-ins actually scheduled for this visit (a day the server added included), else the days picked at discharge.
  const visit = amelia.encounterId;
  const checkIns = [{ encounterId: visit, day: 7 }, { encounterId: visit, day: 2 }, { encounterId: visit, day: 4 }, { encounterId: "visit-other", day: 1 }];
  expect(checkInDaysFor(checkIns, visit, [2, 7])).toEqual([2, 4, 7]);
  expect(checkInDaysFor([], visit, [2, 7])).toEqual([2, 7]);
});
