import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { encounters, guaranteeLetters, hospitals } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { patientsFor } from "../audience";
import type { Change } from "../events";
import { appRouter } from "./index";

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

/** Amelia discharged at 15:40 on Sat 26 Sep (Kuala Lumpur), joined to Sona Care, every change recorded. */
async function world() {
  const clock = { now: new Date("2026-09-26T15:40:00+08:00") };
  const db = await createTestDb();
  await seedDemo(db, clock.now);
  await addClinician(db, "dr-aisyah");
  await db.insert(hospitals).values({ id: "other", name: "Other hospital" });
  await addClinician(db, "dr-other", "other");
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: clock.now }).where(eq(guaranteeLetters.id, "gl-1042"));
  await db.update(encounters).set({ state: { discharge: { glReceived: true, medsConfirmed: true, followUp: "2w", language: "ms" } } }).where(eq(encounters.id, "visit-1042"));
  const changes: Change[] = [];
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), now: () => clock.now, announce: async (_h, c) => { changes.push(c); } } });
  const doctor = as("dr-aisyah");
  return { db, clock, doctor, amelia: as("amelia-account"), other: as("dr-other"), changes };
}

test("before any discharge only 'now' is offered, and a jump says why it cannot", async () => {
  const { doctor } = await world();
  expect(await doctor.demo.status()).toMatchObject({ offsetMs: 0, dischargedAt: null, available: ["now"] });
  expect((await doctor.demo.jump({ to: "day-2" }).catch(e => e)).code).toBe("BAD_REQUEST");
});

test("jumping to day 2 moves every route's clock, sends the check-in to Amelia and tells her app; 'now' comes back", async () => {
  const { db, clock, doctor, amelia, changes } = await world();
  await doctor.discharge.request({ encounterId: "visit-1042", requestId: "req-d1", approvedBy: "dr-aisyah" });
  const { code } = await doctor.care.code({ encounterId: "visit-1042" });
  await amelia.care.join({ code });
  expect((await doctor.demo.status()).available).toEqual(["now", "day-2", "day-7", "visit"]);

  const day2 = await doctor.demo.jump({ to: "day-2" });
  const at = new Date("2026-09-28T10:01:00+08:00");
  expect(day2.now.toISOString()).toBe(at.toISOString());
  expect(day2.offsetMs).toBe(at.getTime() - clock.now.getTime());
  // Both apps read the moved clock: the check-in is sent at the demo time, and Sona Care gets the offset.
  expect((await amelia.care.checkIns.list()).map(c => [c.day, c.sentAt?.toISOString()])).toEqual([[2, at.toISOString()], [7, undefined]]);
  expect(await amelia.care.clock()).toEqual({ offsetMs: day2.offsetMs });
  expect((await doctor.demo.status()).now.toISOString()).toBe(at.toISOString());
  // The jump is announced as "demo", which reaches every linked patient's app.
  expect(changes.at(-1)).toEqual({ topic: "demo" });
  expect(await patientsFor(db, "demo", { topic: "demo" })).toEqual(["SYN-1042"]);

  // Jumping again counts from real time, not from the moved clock; "now" puts it back.
  expect((await doctor.demo.jump({ to: "day-7" })).now.toISOString()).toBe(new Date("2026-10-03T10:01:00+08:00").toISOString());
  expect(await doctor.demo.jump({ to: "now" })).toMatchObject({ offsetMs: 0, now: clock.now });
});

test("a patient's own write names them, so only their app hears it; another hospital cannot move the demo clock", async () => {
  const { db, doctor, amelia, other, changes } = await world();
  await doctor.discharge.request({ encounterId: "visit-1042", requestId: "req-d1", approvedBy: "dr-aisyah" });
  const { code } = await doctor.care.code({ encounterId: "visit-1042" });
  await amelia.care.join({ code });
  await amelia.care.checkIns.reply({ checkInId: "check-in:visit-1042:2", text: "demam balik" });
  expect(changes.at(-1)).toEqual({ topic: "checkIns", patientId: "SYN-1042" });
  // A clinician's write about her visit reaches her through the visit.
  expect(await patientsFor(db, "demo", { topic: "discharge", encounterId: "visit-1042" })).toEqual(["SYN-1042"]);
  expect(await patientsFor(db, "other", { topic: "discharge", encounterId: "visit-1042" })).toEqual([]);
  expect((await other.demo.jump({ to: "now" }).catch(e => e)).code).toBe("FORBIDDEN");
});
