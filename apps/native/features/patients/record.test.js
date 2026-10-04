process.env.TZ = "Asia/Kuala_Lumpur";
import { expect, test } from "bun:test";
import { DEMO_PATIENTS } from "@sona-ai/domain/demo-patients";
import { defaultMedications } from "@/features/encounter/clinical-state";
import { patients as fixtures } from "@/features/encounter/fixtures";
import { initialEncounters, withRoster } from "@/features/encounter/state";
import { counted, dayVisits, letterReceived, serverRoster } from "./record";

// The server's patient list as patients.list returns it: a full record, a ward patient's (only the ward's view) and someone with no visit.
const amelia = { ...DEMO_PATIENTS[0], medicines: ["Amoxicillin 500 mg"] };
const ward = { id: "SYN-2007", encounterId: "visit-2007", name: "Dayang Suhaila", initials: "DS", age: 37, sex: "Female", complaint: "Day 3, asthma exacerbation.", allergies: null, incomplete: false, ward: { status: "fit" } };
const noVisit = { ...ward, id: "SYN-3001", encounterId: "", name: "Clinic Only" };
const records = { [amelia.id]: amelia, [ward.id]: ward, [noVisit.id]: noVisit };

test("the judge build's roster is the server's patients with a visit, in its order, each from their own record", () => {
  const roster = serverRoster(records);
  expect(roster.map(p => [p.id, p.encounterId])).toEqual([["SYN-1042", "visit-1042"], ["SYN-2007", "visit-2007"]]);
  // The server's record, not the fixture's: its medicines, and no demo slot for a time.
  expect(roster[0].medicines).toEqual(["Amoxicillin 500 mg"]);
  expect(roster.map(p => p.time)).toEqual(["", ""]);
  // A ward patient's record holds only the ward's view: what it lacks is empty, never another patient's.
  expect(roster[1]).toMatchObject({ subtitle: "", family: "Not documented", social: "Not documented", history: [], medicines: [], vitals: [], sources: [] });
  // Nothing read yet, or the read failed: nobody, never the fixtures.
  expect(serverRoster(undefined)).toEqual([]);
});

test("each visit starts from its own patient's record as the roster arrives, and a visit under way is kept", () => {
  const roster = serverRoster(records);
  const started = withRoster({}, roster);
  expect(Object.keys(started)).toEqual(["SYN-1042", "SYN-2007"]);
  expect(started["SYN-1042"].medicationEntries.map(m => m.name)).toEqual(["Amoxicillin 500 mg"]);
  expect(started["SYN-2007"].medicationEntries).toEqual([]);
  const working = { ...started, "SYN-1042": { ...started["SYN-1042"], note: "Draft" } };
  // Nobody new: the same object, so the store does not render again.
  expect(withRoster(working, roster)).toBe(working);
  const later = withRoster(working, [...roster, { ...roster[1], id: "SYN-2001" }]);
  expect(later["SYN-1042"].note).toBe("Draft");
  expect(Object.keys(later)).toEqual(["SYN-1042", "SYN-2007", "SYN-2001"]);
  // Sample mode is as it was: the two fixture visits with the fixture's medicines.
  expect(Object.keys(initialEncounters())).toEqual(["SYN-1042", "SYN-1086"]);
  expect(initialEncounters()["SYN-1042"].medicationEntries).toEqual(defaultMedications(fixtures[0]));
});

const appt = (patientId, startsAt) => ({ id: `appt-${patientId}`, patientId, patientName: patientId, initials: "X", incomplete: false, kind: "clinic visit", startsAt: new Date(startsAt) });

test("today's visits are the server's appointments; while they load the judge build has no count, and sample mode keeps its roster", () => {
  const roster = serverRoster(records);
  expect(dayVisits(true, roster, undefined)).toBeUndefined();
  expect(dayVisits(false, fixtures, undefined)).toBe(fixtures);
  // Loaded: only who is booked today, at the appointment's time; an empty day is none, not "still loading".
  const today = [appt("SYN-1042", "2026-10-08T02:15:00Z"), appt("SYN-9999", "2026-10-08T03:00:00Z")];
  for (const judge of [true, false]) expect(dayVisits(judge, roster, today).map(p => [p.id, p.time])).toEqual([["SYN-1042", "10:15"]]);
  expect(dayVisits(true, roster, [])).toEqual([]);
});

test("a key counts what its page shows, and shows no number while that read is on its way", () => {
  expect(counted(17, n => `${n} patients to hand over`, "Loading the handover…")).toEqual({ status: "17 patients to hand over", badge: 17 });
  expect(counted(0, n => `${n} today`, "Reading…")).toEqual({ status: "0 today", badge: 0 });
  expect(counted(undefined, n => `${n} today`, "Reading…")).toEqual({ status: "Reading…" });
});

test("the guarantee letter is read for the visit's own admission: its patient's bed, not a fixed one", () => {
  const gl = { id: "adm-2002-gl", kind: "gl" }, meds = { id: "adm-1042-meds", kind: "pharmacy" };
  const beds = [
    { bed: "Bed 6", patientId: "SYN-1042", admissionId: "adm-1042", blockers: [meds] }, // Amelia's letter has arrived
    { bed: "Bed 2", patientId: "SYN-2002", admissionId: "adm-2002", blockers: [gl] },
    { bed: "Bed 10", status: "empty", blockers: [] },
  ];
  expect(letterReceived(beds, "SYN-1042")).toBe(true);
  expect(letterReceived(beds, "SYN-2002")).toBe(false); // still waiting, whatever Amelia's letter did
  // Amelia's letter still out says nothing about anyone else's.
  expect(letterReceived([{ ...beds[0], blockers: [{ id: "adm-1042-gl", kind: "gl" }] }, beds[1]], "SYN-1042")).toBe(false);
  // No bed (a clinic visit, or gone home and the bed freed): nothing waits on a letter.
  expect(letterReceived(beds, "SYN-1086")).toBe(true);
  expect(letterReceived([], "SYN-1042")).toBe(true);
});
