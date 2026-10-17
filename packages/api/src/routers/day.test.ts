import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { appointments, hospitalMembers, hospitals } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";

import type { Change } from "../events";
import { labFeed } from "./day";
import { appRouter } from "./index";

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

/** Seeded at the fixed clock, so today's appointments fall on 26 Sep (10:15 and 10:45, +08:00). */
async function signedIn() {
  const clock = { now: new Date("2026-09-26T10:00:00+08:00") };
  const db = await createTestDb();
  await seedDemo(db, clock.now);
  await addClinician(db, "dr-aisyah");
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), now: () => clock.now } });
  return { db, clock, api: as("dr-aisyah"), as };
}

async function otherHospital(db: Awaited<ReturnType<typeof signedIn>>["db"], as: (id: string) => ReturnType<typeof createRouterClient<typeof appRouter>>) {
  await db.insert(hospitals).values({ id: "other", name: "Other Hospital (synthetic)" });
  await db.insert(hospitalMembers).values({ userId: "dr-other", hospitalId: "other" });
  return as("dr-other");
}

test("completing a task marks it done, a second completion changes nothing, and another hospital cannot complete it", async () => {
  const { db, api, as } = await signedIn();
  const task = await api.ward.assignOwner({ blockerId: "adm-1042-gl", owner: "Billing" });
  const theirs = await otherHospital(db, as);
  expect((await theirs.tasks.complete({ taskId: task.id }).catch(e => e)).code).toBe("NOT_FOUND");
  expect((await api.tasks.list())[0]?.completed).toBe(false);

  const done = await api.tasks.complete({ taskId: task.id });
  expect([done.id, done.completed]).toEqual([task.id, true]);
  expect(await api.tasks.complete({ taskId: task.id })).toEqual(done);
  expect((await api.tasks.list()).map(t => [t.id, t.completed])).toEqual([[task.id, true]]);
  expect((await api.tasks.complete({ taskId: "no-such-task" }).catch(e => e)).code).toBe("NOT_FOUND");
});

test("lab results list the hospital's results with the patient's name and flag, newest first", async () => {
  const { db, api, as } = await signedIn();
  // Seeded: Daniel's potassium came back two hours ago; his haemoglobin the day before (the ward's pending samples aside).
  expect((await api.results.list()).filter(r => r.flag !== "pending").map(r => [r.patientName, r.test, r.value, r.unit, r.flag, r.receivedAt.toISOString()])).toEqual([
    ["Daniel Rahman", "Potassium", "3.1", "mmol/L", "low", "2026-09-26T00:00:00.000Z"],
    ["Daniel Rahman", "Hb", "9.8", "g/dL", "low", "2026-09-25T00:00:00.000Z"],
  ]);
  expect(await (await otherHospital(db, as)).results.list()).toEqual([]);
});

test("acknowledging a result records who and when, once, and takes it out of the unacknowledged list", async () => {
  const { db, api, as, clock } = await signedIn();
  const unacknowledged = async () => (await api.results.list({ unacknowledged: true })).filter(r => r.flag !== "pending").map(r => r.id);
  expect(await unacknowledged()).toEqual(["lab-1086-potassium", "lab-hb-1086"]);
  expect((await (await otherHospital(db, as)).results.acknowledge({ resultId: "lab-1086-potassium" }).catch(e => e)).code).toBe("NOT_FOUND");

  const acked = await api.results.acknowledge({ resultId: "lab-1086-potassium" });
  expect([acked.acknowledgedBy, acked.acknowledgedAt?.toISOString()]).toEqual(["dr-aisyah", "2026-09-26T02:00:00.000Z"]);
  clock.now = new Date("2026-09-26T11:00:00+08:00");
  await addClinician(db, "dr-colleague");
  expect(await as("dr-colleague").results.acknowledge({ resultId: "lab-1086-potassium" })).toEqual(acked); // the first acknowledgement stands
  expect(await unacknowledged()).toEqual(["lab-hb-1086"]);
  expect((await api.results.list()).filter(r => r.flag !== "pending").map(r => [r.id, r.acknowledgedBy])).toEqual([["lab-1086-potassium", "dr-aisyah"], ["lab-hb-1086", null]]);
  expect((await api.results.acknowledge({ resultId: "lab-none" }).catch(e => e)).code).toBe("NOT_FOUND");
});

test("my day lists that date's appointments in the hospital's day (+08:00), in time order, with the patient's name", async () => {
  const { db, api, as } = await signedIn();
  const at = (id: string, startsAt: string) => ({ id, patientId: "SYN-1086", hospitalId: "demo", kind: "clinic visit", startsAt: new Date(startsAt) });
  await db.insert(appointments).values([
    at("appt-late", "2026-09-26T23:30:00+08:00"), at("appt-early", "2026-09-26T08:00:00+08:00"),
    at("appt-tomorrow", "2026-09-27T00:30:00+08:00"), at("appt-yesterday", "2026-09-25T23:30:00+08:00"),
  ]);
  const today = await api.day.list({ date: "2026-09-26" });
  expect(today.map(a => [a.id, a.patientName, a.startsAt.toISOString()])).toEqual([
    ["appt-early", "Daniel Rahman", "2026-09-26T00:00:00.000Z"],
    ["appt-SYN-1042", "Amelia Tan", "2026-09-26T02:15:00.000Z"],
    ["appt-SYN-1086", "Daniel Rahman", "2026-09-26T02:45:00.000Z"],
    ["appt-late", "Daniel Rahman", "2026-09-26T15:30:00.000Z"],
  ]);
  expect(today[1]).toMatchObject({ patientId: "SYN-1042", initials: "AT", incomplete: false, kind: "clinic visit" });
  expect((await api.day.list({ date: "2026-09-28" }))).toEqual([]);
  expect(await (await otherHospital(db, as)).day.list({ date: "2026-09-26" })).toEqual([]);
  expect((await api.day.list({ date: "26/09/2026" }).catch(e => e)).code).toBe("BAD_REQUEST");
});

test("a result entered by a signed-in clinician past a call-now limit arrives flagged critical; a normal one arrives unflagged", async () => {
  const { api, db, as, clock } = await signedIn();
  const critical = await api.results.receive({ patientId: "SYN-1086", test: "Potassium", value: "2.6", unit: "mmol/L" });
  expect(critical).toMatchObject({ patientName: "Daniel Rahman", flag: "critical low", critical: true, acknowledgedAt: null });
  clock.now = new Date(clock.now.getTime() + 60_000);
  const normal = await api.results.receive({ patientId: "SYN-1042", test: "Sodium", value: "138", unit: "mmol/L" });
  expect(normal).toMatchObject({ flag: null, critical: false });
  // Newest first (the normal result came a minute later), each still waiting on a doctor.
  expect((await api.results.list({ unacknowledged: true })).slice(0, 2).map(r => [r.id, r.critical])).toEqual([[normal.id, false], [critical.id, true]]);
  // Another hospital's lab cannot post to this hospital's patient.
  expect((await (await otherHospital(db, as)).results.receive({ patientId: "SYN-1086", test: "Potassium", value: "2.6", unit: "mmol/L" }).catch(e => e)).code).toBe("NOT_FOUND");
});

test("a result outside the usual adult range arrives flagged high or low, a lab's own flag is kept as sent, and critical still wins", async () => {
  const { api } = await signedIn();
  expect(await api.results.receive({ patientId: "SYN-1042", test: "CRP", value: "86", unit: "mg/L" }))
    .toMatchObject({ flag: "high", critical: false, why: "CRP 86 mg/L is above the usual adult range of up to 5 mg/L" });
  expect(await api.results.receive({ patientId: "SYN-1042", test: "CRP", value: "86", unit: "mg/L", flag: "normal" })).toMatchObject({ flag: "normal" });
  expect(await api.results.receive({ patientId: "SYN-1042", test: "Troponin", value: "40", unit: "ng/L", flag: "H" })).toMatchObject({ flag: "high", why: undefined });
  expect(await api.results.receive({ patientId: "SYN-1086", test: "Potassium", value: "2.6", unit: "mmol/L", flag: "low" })).toMatchObject({ flag: "critical low", critical: true });
  expect((await api.results.receive({ patientId: "SYN-1042", test: "CRP", value: "86", unit: "mg/L", flag: "abnormal-ish" }).catch(e => e)).code).toBe("BAD_REQUEST");
});

test("the lab's own system posts a result with its shared secret: refused without the right one, closed while no secret is set, and a right one lands as results.receive does and is announced", async () => {
  const { api, db, clock } = await signedIn();
  const SECRET = "lab-secret-for-this-test-only";
  const announced: [string, Change][] = [];
  const context = { db, now: () => clock.now, announce: async (hospitalId: string, change: Change) => { announced.push([hospitalId, change]); } };
  const potassium = { patientId: "SYN-1086", test: "Potassium", value: "2.6", unit: "mmol/L" };
  const post = (authorization: string | undefined, body: unknown, secret: string | undefined = SECRET) => labFeed(context, secret, new Request("https://sona.test/lab/results", {
    method: "POST", headers: { "content-type": "application/json", ...authorization ? { authorization } : {} }, body: typeof body === "string" ? body : JSON.stringify(body),
  }));
  const before = (await api.results.list()).length;
  // No secret configured: the route is closed, even to a caller who sends an empty or any credential.
  expect((await post(`Bearer ${SECRET}`, potassium, "")).status).toBe(404);
  expect((await post("Bearer ", potassium, "")).status).toBe(404);
  // Missing, wrong, and right-but-not-a-bearer credentials are all refused.
  for (const wrong of [undefined, "Bearer wrong", `Bearer ${SECRET}x`, SECRET, "Bearer "]) expect((await post(wrong, potassium)).status).toBe(401);
  expect((await api.results.list()).length).toBe(before);
  expect(announced).toEqual([]);

  expect((await post(`Bearer ${SECRET}`, "not json")).status).toBe(400);
  expect((await post(`Bearer ${SECRET}`, { patientId: "SYN-1086", test: "Potassium" })).status).toBe(400);
  expect((await post(`Bearer ${SECRET}`, { ...potassium, patientId: "SYN-none" })).status).toBe(404);

  const res = await post(`Bearer ${SECRET}`, potassium);
  expect(res.status).toBe(201);
  const landed = await res.json() as { id: string };
  expect(landed).toMatchObject({ patientName: "Daniel Rahman", flag: "critical low", critical: true, acknowledgedAt: null, receivedAt: clock.now.toISOString() });
  // What the clinician's app reads is the same row, critical and waiting; the hospital's apps were told results changed.
  expect((await api.results.list({ unacknowledged: true }))[0]).toMatchObject({ id: landed.id, critical: true, value: "2.6" });
  expect(announced).toEqual([["demo", { topic: "results", patientId: "SYN-1086" }]]);
  // A pending sample is filled in place, as from the app; a failed announcement never fails the result.
  const failing = { ...context, announce: async () => { throw new Error("channel down"); } };
  const culture = await labFeed(failing, SECRET, new Request("https://sona.test/lab/results", { method: "POST", headers: { authorization: `Bearer ${SECRET}` }, body: JSON.stringify({ patientId: "SYN-2002", test: "Urine culture sensitivities", value: "No growth" }) }));
  expect([culture.status, (await culture.json() as { id: string }).id]).toEqual([201, "lab-2002-b2-result"]);
  // A sender that fills every field sends an empty unit for a text result: accepted as a result with no unit.
  const unitless = await post(`Bearer ${SECRET}`, { patientId: "SYN-2002", test: "Blood culture", value: "No growth at 48 h", unit: "" });
  expect([unitless.status, await unitless.json()]).toEqual([201, expect.objectContaining({ test: "Blood culture", unit: null, flag: null })]);
});

test("a result for a sample the lab was still running fills that pending row, so the ward and the discharge stop waiting on it", async () => {
  const { api } = await signedIn();
  const blockersOf = async () => (await api.ward.beds()).find(b => b.bed === "Bed 2")!.blockers.map(b => b.kind);
  expect(await blockersOf()).toContain("result");
  const arrived = await api.results.receive({ patientId: "SYN-2002", test: "urine culture sensitivities ", value: "E. coli, sensitive to cefalexin" });
  expect(arrived).toMatchObject({ id: "lab-2002-b2-result", test: "Urine culture sensitivities", value: "E. coli, sensitive to cefalexin", flag: null });
  expect(await blockersOf()).not.toContain("result");
  expect((await api.results.list()).some(r => r.id === "lab-2002-b2-result")).toBe(true);
  // With no sample left pending, a repeat test is a new result.
  expect((await api.results.receive({ patientId: "SYN-2002", test: "Urine culture sensitivities", value: "No growth" })).id).not.toBe("lab-2002-b2-result");
});

test("handover says who acknowledged a critical result and how long it took; an acknowledged ordinary result is no longer 'act on'", async () => {
  const { api, clock } = await signedIn();
  const critical = await api.results.receive({ patientId: "SYN-1086", test: "Potassium", value: "2.6", unit: "mmol/L" });
  clock.now = new Date(clock.now.getTime() + 72_000);
  await api.results.acknowledge({ resultId: critical.id });
  await api.results.acknowledge({ resultId: "lab-hb-1086" });
  const daniel = (await api.handover.list()).find(c => c.patientId === "SYN-1086")!;
  expect(daniel.recommendation).toContain("Critical potassium 2.6 mmol/L acknowledged by dr-aisyah after 1:12");
  expect(daniel.recommendation.some(l => l.startsWith("Act on low Hb"))).toBe(false);
  expect(daniel.recommendation.some(l => l.startsWith("Act on low potassium (3.1 mmol/L)"))).toBe(true);
});

test("patients list the hospital's people with their full record and visit, so live mode shows what the server holds", async () => {
  const { api, db, as } = await signedIn();
  const people = await api.patients.list();
  expect(people.map(p => [p.id, p.encounterId, p.name, p.incomplete])).toEqual([
    ["SYN-1042", "visit-1042", "Amelia Tan", false], ["SYN-1086", "visit-1086", "Daniel Rahman", true],
    // The ward (the fixture beds and the seed's WARD_EXTRA): 17 people in all, each a real row with a visit.
    ...[["2001", "Hafizah Yusof"], ["2002", "Nurul Huda"], ["2003", "Chong Mei Yee"], ["2004", "Tan Ah Kow"], ["2005", "Suresh Pillai"], ["2007", "Dayang Suhaila"], ["2008", "Priya Nair"], ["2009", "Ravi Kumar"],
      ["2011", "Ganesan Muthu"], ["2012", "Siti Aminah"], ["2013", "Wong Siew Ling"], ["2014", "Lim Wei Jie"], ["2015", "Jimmy Anak Sali"], ["2016", "Rosnah Ismail"], ["2017", "Harjit Singh"]].map(([n, name]) => [`SYN-${n}`, `visit-${n}`, name, false]),
  ]);
  // A ward patient's list entry is its own columns: who they are and why they are in (the patient list's row; their bed comes from ward.beds).
  expect(people.find(p => p.id === "SYN-2017")).toMatchObject({ initials: "HS", age: 63, sex: "Male", complaint: "Upper GI bleed, day 2 after endoscopy." });
  const beds = await api.ward.beds();
  expect(people.filter(p => p.id.startsWith("SYN-20")).every(p => beds.some(b => b.patientId === p.id))).toBe(true);
  expect(people[0]).toMatchObject({ subtitle: "Respiratory review", allergies: "Penicillin — reported rash; details need confirmation", medicines: ["Salbutamol inhaler, as needed", "Cetirizine tablet 10 mg, patient-reported"] });
  expect(people[0]!.history).toContain("Asthma since childhood");
  expect(people[0]!.sources.map(s => s.id)).toContain("history");
  expect(await (await otherHospital(db, as)).patients.list()).toEqual([]);
});

// lane T2
test("a doctor's follow-up is saved once for the visit, a replay returns it, and another hospital's visit is not found", async () => {
  const { db, api, as } = await signedIn();
  const followUp = { encounterId: "visit-1042", title: "  Review inhaler technique ", owner: " Dr Aisyah ", due: "2026-10-03", requestId: "req-1" };
  const task = await api.tasks.create(followUp);
  expect(task).toMatchObject({ encounterId: "visit-1042", kind: "followup", title: "Review inhaler technique", owner: "Dr Aisyah", due: "2026-10-03", completed: false });
  expect(await api.tasks.create(followUp)).toEqual(task);
  expect((await api.tasks.list()).map(t => t.id)).toEqual([task.id]);

  expect((await api.tasks.create({ ...followUp, encounterId: "no-such-visit", requestId: "req-2" }).catch(e => e)).code).toBe("NOT_FOUND");
  const theirs = await otherHospital(db, as);
  expect((await theirs.tasks.create({ ...followUp, requestId: "req-3" }).catch(e => e)).code).toBe("NOT_FOUND");
  expect(await theirs.tasks.list()).toEqual([]);
});

test("a follow-up needs a title, an owner and a real date, and a signed-in doctor", async () => {
  const { db, api } = await signedIn();
  const followUp = { encounterId: "visit-1042", title: "Review", owner: "Nurse", requestId: "req-1" };
  expect((await api.tasks.create(followUp)).due).toBeNull(); // the date is optional
  for (const bad of [{ title: "  " }, { owner: "" }, { title: "x".repeat(201) }, { owner: "x".repeat(81) }, { due: "3/10/2026" }])
    expect((await api.tasks.create({ ...followUp, ...bad, requestId: "req-bad" }).catch(e => e)).code).toBe("BAD_REQUEST");
  const anonymous = createRouterClient(appRouter, { context: { db, session: null } });
  expect((await anonymous.tasks.create(followUp).catch(e => e)).code).toBe("UNAUTHORIZED");
});
