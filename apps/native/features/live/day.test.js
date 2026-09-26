process.env.TZ = "Asia/Kuala_Lumpur";
import { expect, test } from "bun:test";
import { mergeServerState, newestResult, serverDayPatients, serverTasks, serverVisit } from "./day";

const task = (over = {}) => ({ id: "t1", hospitalId: "demo", encounterId: "visit-1042", kind: "discharge", title: "Book review clinic", owner: "Clinic clerk", due: "2026-10-10", completed: false, sourceId: null, idempotencyKey: "k", createdAt: new Date("2026-09-26T02:00:00Z"), ...over });

test("a visit's server tasks become the app's tasks; tasks without a due date or for other visits are handled", () => {
  const rows = [task(), task({ id: "t2", due: null, completed: true, title: "Coding query: anaemia" }), task({ id: "t3", encounterId: "visit-1086" }), task({ id: "t4", encounterId: null })];
  expect(serverTasks(rows, "visit-1042")).toEqual([
    { id: "t1", title: "Book review clinic", owner: "Clinic clerk", due: "2026-10-10", completed: false },
    { id: "t2", title: "Coding query: anaemia", owner: "Clinic clerk", due: "", completed: true },
  ]);
  expect(serverTasks(rows, "visit-404")).toEqual([]);
});

const result = (over = {}) => ({ id: "lab-1086-potassium", patientId: "SYN-1086", patientName: "Daniel Rahman", test: "Potassium", value: "3.1", unit: "mmol/L", flag: "low", receivedAt: new Date("2026-09-26T00:00:00Z"), acknowledgedBy: null, acknowledgedAt: null, ...over });

test("the newest unacknowledged result reads like the app's pending result, in local time", () => {
  const rows = [result({ id: "new-ack", acknowledgedAt: new Date() }), result(), result({ id: "lab-hb", test: "Hb", value: "9.8", unit: "g/dL", receivedAt: new Date("2026-09-25T00:00:00Z") })];
  expect(newestResult(rows)).toEqual({ id: "lab-1086-potassium", patientId: "SYN-1086", test: "Potassium", value: "3.1 mmol/L", flag: "Low", receivedAt: "08:00" });
  expect(newestResult([result({ unit: null, flag: null })])).toMatchObject({ value: "3.1", flag: "New" });
  expect(newestResult([])).toBeUndefined();
});

const appt = (over = {}) => ({ id: "appt-SYN-1042", patientId: "SYN-1042", patientName: "Amelia Tan", initials: "AT", incomplete: false, kind: "clinic visit", startsAt: new Date("2026-09-26T02:15:00Z"), ...over });
const patient = (id, time) => ({ id, name: id, time, subtitle: "Cough", incomplete: false });

test("today's server appointments pick which demo patients are seen and at what local time, earliest first", () => {
  const patients = [patient("SYN-1042", "09:00"), patient("SYN-1086", "09:30"), patient("SYN-2000", "11:00")];
  const day = serverDayPatients(patients, [appt({ id: "a2", patientId: "SYN-1086", startsAt: new Date("2026-09-26T01:45:00Z") }), appt(), appt({ id: "a3", patientId: "SYN-9999" })]);
  expect(day.map(p => [p.id, p.time])).toEqual([["SYN-1086", "09:45"], ["SYN-1042", "10:15"]]);
});

test("any day's appointment becomes a schedule visit, opening the demo patient when there is one", () => {
  expect(serverVisit(appt(), ["SYN-1042"])).toEqual({ id: "appt-SYN-1042", name: "Amelia Tan", initials: "AT", time: "10:15", reason: "Clinic visit", incomplete: false, patientId: "SYN-1042" });
  expect(serverVisit(appt({ patientId: "SYN-7" }), ["SYN-1042"]).patientId).toBeUndefined();
});

test("the server's visit state replaces the fixture's: confirmed medicines, eligibility, discharge fixes and claim status", () => {
  const local = { revision: 3, medicationEntries: [{ id: "m1", name: "Salbutamol", ingredient: "salbutamol", formulation: "inhaler", confirmed: false }], discharge: { language: "en" } };
  const server = {
    medicationEntries: [{ id: "m1", name: "Salbutamol", ingredient: "salbutamol", formulation: "inhaler", confirmed: true }],
    prescriptionInputs: { weightKg: "62", liverDisease: "no", kidneyDisease: "no", alcoholRisk: "no", paracetamolAllergy: "no" },
    discharge: { medsConfirmed: true, language: "ms" },
    claim: { organismConfirmed: true },
  };
  const merged = mergeServerState(local, server, { status: "approved", approvedAt: "2026-09-26T06:11:00Z" }, true);
  expect(merged.medicationEntries[0].confirmed).toBe(true);
  expect(merged.prescriptionInputs.weightKg).toBe("62");
  expect(merged.discharge).toMatchObject({ medsConfirmed: true, language: "ms", glReceived: true });
  expect(merged.claim).toMatchObject({ organismConfirmed: true, status: "approved", approvedAt: "2026-09-26T06:11:00Z" });
  expect(merged.revision).toBe(3); // the app's revision counter is its own
});

test("what the server has not recorded keeps the app's own value", () => {
  const local = { revision: 1, medicationEntries: [{ id: "m1", name: "Cetirizine", ingredient: "cetirizine", formulation: "tablet", confirmed: false }] };
  expect(mergeServerState(local, {}, { status: "draft" }, false).medicationEntries).toEqual(local.medicationEntries);
});

test("the server's history facts replace the fixture's; without any the app keeps its own", () => {
  const fact = (id, value) => ({ id, category: "allergy", value, source: "Doctor", date: "26 Sep 2026", revision: 1 });
  const local = { revision: 2, historyFacts: [fact("h1", "No known allergies")] };
  expect(mergeServerState(local, { historyFacts: [fact("h1", "Penicillin (rash)")] }, { status: "draft" }, false).historyFacts).toEqual([fact("h1", "Penicillin (rash)")]);
  expect(mergeServerState(local, {}, { status: "draft" }, false).historyFacts).toEqual(local.historyFacts);
});
