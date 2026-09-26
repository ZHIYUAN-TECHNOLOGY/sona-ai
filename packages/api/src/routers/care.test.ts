import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { careLinks, hospitalMembers } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";

import type { Change } from "../events";
import { hospitalOf } from "./hospital";
import { appRouter } from "./index";

const user = (id: string, name = id) => ({
  user: { id, name, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

/** A clinician (the test doctor) and a Sona Care account for Amelia, sharing one database and clock. */
async function world() {
  const db = await createTestDb();
  const clock = { now: new Date("2026-09-26T10:00:00+08:00") };
  await seedDemo(db, clock.now);
  const heard: [string, Change][] = [];
  const as = (session: Session | null) => createRouterClient(appRouter, { context: { db, session, now: () => clock.now, announce: async (h: string, c: Change) => { heard.push([h, c]); } } });
  return { db, clock, heard, doctor: as(user("dr-aisyah")), amelia: as(user("amelia-account", "Amelia Tan")), anyone: as(null), as };
}

test("the doctor issues Amelia's code once per visit; anyone can preview it, and it shows only her first name and the hospital", async () => {
  const { doctor, anyone } = await world();
  const issued = await doctor.care.code({ encounterId: "visit-1042" });
  expect(issued.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  expect(await doctor.care.code({ encounterId: "visit-1042" })).toEqual(issued);
  expect(issued.link).toBe(`sona-care://join?code=${issued.code}`);
  expect(await anyone.care.preview({ code: issued.code.toLowerCase().replace("-", "") })).toEqual({ firstName: "Amelia", hospital: "Demo General Hospital (synthetic)" });
  expect((await anyone.care.preview({ code: "ZZZZ-ZZZZ" }).catch(e => e)).code).toBe("NOT_FOUND");
});

test("redeeming links the account to Amelia only: it reads her own record, and never opens a clinical route", async () => {
  const { doctor, amelia, db } = await world();
  const { code } = await doctor.care.code({ encounterId: "visit-1042" });
  expect(await amelia.care.join({ code })).toEqual({ firstName: "Amelia" });
  expect(await amelia.care.join({ code })).toEqual({ firstName: "Amelia" }); // a replay by the same account changes nothing
  expect(await amelia.care.me()).toMatchObject({ patientId: "SYN-1042", name: "Amelia Tan", firstName: "Amelia", encounterId: "visit-1042", hospital: "Demo General Hospital (synthetic)", dischargedAt: undefined });
  for (const call of [() => amelia.tasks.list(), () => amelia.results.list(), () => amelia.ward.beds(), () => amelia.encounter.get({ encounterId: "visit-1086" })])
    expect((await call().catch(e => e)).code).toBe("FORBIDDEN");
  // The Sona Care account never joined a hospital as a clinician.
  expect(await db.select().from(hospitalMembers)).toHaveLength(1);
  expect((await db.select().from(careLinks))[0]).toMatchObject({ userId: "amelia-account", patientId: "SYN-1042" });
});

test("a code redeems once; an expired code, a clinician account and a signed-out caller cannot join", async () => {
  const { doctor, amelia, clock, as } = await world();
  const { code } = await doctor.care.code({ encounterId: "visit-1042" });
  await amelia.care.join({ code });
  expect((await as(user("someone-else")).care.join({ code }).catch(e => e)).code).toBe("CONFLICT");
  expect((await doctor.care.join({ code }).catch(e => e)).code).toBe("FORBIDDEN");
  const other = await doctor.care.code({ encounterId: "visit-1086" });
  clock.now = new Date(clock.now.getTime() + 15 * 24 * 3600_000);
  expect((await as(user("late")).care.join({ code: other.code }).catch(e => e)).code).toBe("PRECONDITION_FAILED");
  expect((await as(null).care.join({ code: other.code }).catch(e => e)).code).toBe("UNAUTHORIZED");
});

test("an account that is not linked cannot use Sona Care routes", async () => {
  const { doctor, as } = await world();
  expect((await doctor.care.me().catch(e => e)).code).toBe("FORBIDDEN");
  expect((await as(user("new-person")).care.me().catch(e => e)).code).toBe("FORBIDDEN");
});

test("a Sona Care account is never made a clinician, whichever door it tries (the API, or the live-updates socket's hospital lookup)", async () => {
  const { doctor, amelia, db } = await world();
  const { code } = await doctor.care.code({ encounterId: "visit-1042" });
  await amelia.care.join({ code });
  expect((await hospitalOf(db, "amelia-account").catch(e => e)).code).toBe("FORBIDDEN");
  expect(await db.select().from(hospitalMembers)).toHaveLength(1);
});
