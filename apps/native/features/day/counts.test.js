import { expect, test } from "bun:test";
import { EMPTY_DISCHARGE, dischargeChecks, planFor } from "@sona-ai/domain/discharge";
import { newEncounter, patients } from "@/features/encounter/fixtures";
import { fixtureFindings } from "@/features/findings/model";
import { wardBeds } from "@/features/ward/model";
import { allergyConfirmation, allergyLine, flagTone, needLine, needsYou, openTaskCount, patientFlags, patientResult, pendingResult, receiptLine, resultKey, resultLine, todaysResults, withFindingBlockers } from "./counts";
import { PENDING_RESULT } from "./model";

const row = (over = {}) => ({ id: "lab-1", patientId: "SYN-1086", patientName: "Daniel Rahman", test: "Potassium", value: "3.1", unit: "mmol/L", flag: "low", receivedAt: new Date("2026-09-30T00:00:00Z"), acknowledgedBy: null, acknowledgedAt: null, acknowledgedByName: null, critical: false, ...over });
const encounters = Object.fromEntries(patients.map(p => [p.id, newEncounter()]));

test("demo: the fixture result waits until it is acknowledged here, then leaves every count", () => {
  const acked = { [resultKey(PENDING_RESULT)]: { at: "2026-09-30T02:14:00Z", by: "Dr Lim" } };
  expect(pendingResult(undefined, {})).toBe(PENDING_RESULT);
  expect(pendingResult(undefined, acked)).toBeUndefined();
  // Patients are counted, not items: Amelia (allergy, medicines) and Daniel (the result, then missing history).
  expect(needsYou(patients, encounters, [PENDING_RESULT]).map(n => [n.id, n.flag.label])).toEqual([["SYN-1086", "Low potassium 3.1 mmol/L"], ["SYN-1042", "Penicillin allergy · confirm"]]);
  expect(needsYou(patients, encounters, []).find(n => n.id === "SYN-1086").flag.label).toBe("History incomplete");
  expect(patientResult("SYN-1086", undefined, acked)).toEqual({ result: PENDING_RESULT, ack: acked[resultKey(PENDING_RESULT)] });
  expect(patientResult("SYN-1042", undefined, {})).toBeUndefined();
  expect(resultLine(PENDING_RESULT)).toBe("Potassium 3.1 mmol/L · low · last 3.8 on 14 Sep");
});

test("live: the server's acknowledgement is the one that counts, with who and when, and the previous value", () => {
  const now = new Date("2026-09-30T03:00:00Z");
  const earlier = row({ id: "lab-0", value: "3.8", receivedAt: new Date("2026-09-14T12:00:00Z"), acknowledgedAt: new Date("2026-09-14T13:00:00Z"), acknowledgedByName: "Dr Tan" });
  const waiting = { tasks: [], results: [earlier, row()] };
  expect(pendingResult(waiting, {})).toMatchObject({ id: "lab-1", value: "3.1 mmol/L", flag: "Low", last: "3.8 on 14 Sep" });
  expect(patientResult("SYN-1086", waiting, {}, now)).toMatchObject({ result: { id: "lab-1" }, ack: undefined });
  const done = { tasks: [], results: [earlier, row({ acknowledgedAt: new Date("2026-09-30T02:14:00Z"), acknowledgedByName: "Dr Lim" })] };
  expect(pendingResult(done, {})).toBeUndefined();
  expect(patientResult("SYN-1086", done, {}, now).ack).toEqual({ at: "2026-09-30T02:14:00.000Z", by: "Dr Lim" });
  // Acknowledged on another day: history, not news.
  expect(patientResult("SYN-1086", done, {}, new Date("2026-10-02T03:00:00Z"))).toBeUndefined();
  // A newer acknowledged result never hides an older one still waiting: the briefing leads with the one to act on.
  const mixed = { tasks: [], results: [row({ id: "lab-2", test: "Haemoglobin", receivedAt: new Date("2026-09-30T02:00:00Z") }), row({ id: "lab-3", receivedAt: new Date("2026-09-30T02:30:00Z"), acknowledgedAt: new Date("2026-09-30T02:40:00Z"), acknowledgedByName: "Dr Lim" })] };
  expect(patientResult("SYN-1086", mixed, {}, now)).toMatchObject({ result: { id: "lab-2" }, ack: undefined });
  // Once it is acknowledged too, its receipt shows, not the newer result acknowledged earlier.
  const bothDone = { tasks: [], results: [row({ id: "lab-2", test: "Haemoglobin", receivedAt: new Date("2026-09-30T02:00:00Z"), acknowledgedAt: new Date("2026-09-30T02:50:00Z"), acknowledgedByName: "Dr Aisyah" }), mixed.results[1]] };
  expect(patientResult("SYN-1086", bothDone, {}, now)).toMatchObject({ result: { id: "lab-2" }, ack: { by: "Dr Aisyah" } });
  expect(receiptLine({ at: new Date(2026, 8, 30, 10, 14).toISOString(), by: "Dr Lim" }, new Date(2026, 8, 30, 12))).toBe("Acknowledged 10:14 by Dr Lim");
  expect(receiptLine({ at: new Date(2026, 8, 29, 10, 14).toISOString(), by: "Dr Lim" }, new Date(2026, 8, 30, 12))).toBe("Acknowledged 29 Sep 10:14 by Dr Lim");
});

test("the Results page: waiting results first, then today's acknowledged ones, each newest first; older acknowledged ones are history", () => {
  const now = new Date("2026-09-30T05:00:00Z");
  const results = [
    row({ id: "old", receivedAt: new Date("2026-09-29T01:00:00Z"), acknowledgedAt: new Date("2026-09-29T02:00:00Z"), acknowledgedByName: "Dr Tan" }),
    row({ id: "acked", receivedAt: new Date("2026-09-30T04:00:00Z"), acknowledgedAt: new Date("2026-09-30T04:10:00Z"), acknowledgedByName: "Dr Lim" }),
    row({ id: "low", receivedAt: new Date("2026-09-30T01:00:00Z") }),
    row({ id: "critical", flag: "critical low", value: "2.6", receivedAt: new Date("2026-09-30T02:00:00Z") }),
    row({ id: "yesterday", receivedAt: new Date("2026-09-29T03:00:00Z") }),
  ];
  const rows = todaysResults({ tasks: [], results }, {}, now);
  expect(rows.map(r => r.key)).toEqual(["critical", "low", "yesterday", "acked"]);
  expect(rows[0]).toMatchObject({ name: "Daniel Rahman", value: "2.6 mmol/L", flag: "critical low" });
  expect(rows[3].ack).toEqual({ at: "2026-09-30T04:10:00.000Z", by: "Dr Lim" });
  // Demo: the fixture, acknowledged here.
  const at = new Date(2026, 8, 30, 12);
  expect(todaysResults(undefined, {}, at)).toMatchObject([{ patientId: "SYN-1086", flag: "Low", value: "3.1 mmol/L" }]);
  expect(todaysResults(undefined, { [resultKey(PENDING_RESULT)]: { at: at.toISOString(), by: "Dr Lim" } }, at)[0].ack.by).toBe("Dr Lim");
  expect(["critical high", "Low", "high", "", "New"].map(flagTone)).toEqual(["urgent", "soon", "soon", undefined, undefined]);
});

test("the allergy flag clears once a clinician confirms it, and a discharge leaves only a waiting result", () => {
  const [amelia, daniel] = ["SYN-1042", "SYN-1086"].map(id => patients.find(p => p.id === id));
  const at = new Date(2026, 9, 3, 14, 32);
  const fact = allergyConfirmation(amelia, 2, "Dr Lim", at);
  expect(fact).toMatchObject({ category: "allergy", value: "Penicillin — reported rash", source: "Confirmed by Dr Lim", date: "2026-10-03 14:32", revision: 2 });
  expect([allergyLine(fact, new Date(2026, 9, 3, 18)), allergyLine(fact, new Date(2026, 9, 4, 9)), allergyLine({ date: "2026-10-03" }, at)])
    .toEqual(["Allergy confirmed · 14:32", "Allergy confirmed · 3 Oct 14:32", "Allergy confirmed · today"]);
  const label = list => list.find(n => n.id === "SYN-1042")?.flag.label;
  const confirmed = { ...encounters, "SYN-1042": { ...newEncounter(), historyFacts: [fact] } };
  expect(label(needsYou(patients, confirmed, []))).toBe("2 medicines unconfirmed");
  // Discharged: nothing left to do in the visit, so Amelia leaves; a result still waiting keeps Daniel.
  const discharged = { ...newEncounter(), discharge: { dischargedAt: at.toISOString() } };
  expect(label(needsYou(patients, { ...encounters, "SYN-1042": discharged }, []))).toBeUndefined();
  expect(patientFlags(daniel, 1, PENDING_RESULT, discharged).map(f => f.label)).toEqual(["Low potassium 3.1 mmol/L"]);
  // An allergy recorded for an incomplete history is no longer unknown.
  expect(patientFlags(daniel, 1, undefined, { ...newEncounter(), historyFacts: [{ ...fact, value: "No known allergies" }] }).map(f => f.label)).toEqual(["History incomplete"]);
});

test("'needs you' is always a count of patients", () => {
  expect([0, 1, 2].map(needLine)).toEqual(["Nobody needs you now", "1 patient needs you", "2 patients need you"]);
});

test("open tasks are the Tasks page's list: device tasks plus the server's in live mode", () => {
  const withTask = { ...encounters, "SYN-1042": { ...newEncounter(), tasks: [{ id: "t", title: "Call", owner: "Me", due: "Today", completed: false }, { id: "d", title: "Done", owner: "Me", due: "Today", completed: true }] } };
  const amelia = patients.find(p => p.id === "SYN-1042");
  const server = { results: [], tasks: [{ id: "s1", encounterId: amelia.encounterId, title: "Book clinic", owner: "Clerk", due: null, completed: false }] };
  expect(openTaskCount(patients, withTask, undefined)).toBe(1);
  expect(openTaskCount(patients, withTask, server)).toBe(2);
  expect(openTaskCount(patients.filter(p => p.id !== "SYN-1042"), withTask, server)).toBe(0);
});

test("demo Bed 6 counts the same blockers on the Ward as on its Discharge page, open X-ray findings included", () => {
  const amelia = patients.find(p => p.id === "SYN-1042");
  const findings = fixtureFindings(new Date("2026-09-30T00:00:00Z"));
  const bed6 = beds => beds.find(b => b.patientId === "SYN-1042");
  const blocked = found => dischargeChecks(EMPTY_DISCHARGE, planFor(amelia), found.filter(f => f.status === "open")).filter(c => c.status === "blocked").length;
  expect(bed6(withFindingBlockers(wardBeds(patients, {}), findings)).blockers.length).toBe(blocked(findings));
  expect(blocked(findings)).toBe(5);
  // Tracking one clears it in both places.
  const tracked = findings.map((f, i) => i ? f : { ...f, status: "tracked" });
  expect(bed6(withFindingBlockers(wardBeds(patients, {}), tracked)).blockers.length).toBe(blocked(tracked));
});
