import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { appointments, hospitalMembers, hospitals } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";

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
  // Seeded: Daniel's potassium came back two hours ago; his haemoglobin the day before.
  expect((await api.results.list()).map(r => [r.patientName, r.test, r.value, r.unit, r.flag, r.receivedAt.toISOString()])).toEqual([
    ["Daniel Rahman", "Potassium", "3.1", "mmol/L", "low", "2026-09-26T00:00:00.000Z"],
    ["Daniel Rahman", "Hb", "9.8", "g/dL", "low", "2026-09-25T00:00:00.000Z"],
  ]);
  expect(await (await otherHospital(db, as)).results.list()).toEqual([]);
});

test("acknowledging a result records who and when, once, and takes it out of the unacknowledged list", async () => {
  const { db, api, as, clock } = await signedIn();
  expect((await api.results.list({ unacknowledged: true })).map(r => r.id)).toEqual(["lab-1086-potassium", "lab-hb-1086"]);
  expect((await (await otherHospital(db, as)).results.acknowledge({ resultId: "lab-1086-potassium" }).catch(e => e)).code).toBe("NOT_FOUND");

  const acked = await api.results.acknowledge({ resultId: "lab-1086-potassium" });
  expect([acked.acknowledgedBy, acked.acknowledgedAt?.toISOString()]).toEqual(["dr-aisyah", "2026-09-26T02:00:00.000Z"]);
  clock.now = new Date("2026-09-26T11:00:00+08:00");
  expect(await as("dr-colleague").results.acknowledge({ resultId: "lab-1086-potassium" })).toEqual(acked); // the first acknowledgement stands
  expect((await api.results.list({ unacknowledged: true })).map(r => r.id)).toEqual(["lab-hb-1086"]);
  expect((await api.results.list()).map(r => [r.id, r.acknowledgedBy])).toEqual([["lab-1086-potassium", "dr-aisyah"], ["lab-hb-1086", null]]);
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
