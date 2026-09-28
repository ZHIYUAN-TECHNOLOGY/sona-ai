import { hospitalMembers, hospitals } from "@sona-ai/db/schema/clinical";
import { DEMO_CLINICIANS, DEMO_HOSPITAL } from "@sona-ai/db/demo";
import { createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";

import { hospitalOf, memberOf } from "./hospital";

test("an account that is neither a member nor on the demo clinician list is refused, and not made a member", async () => {
  const db = await createTestDb();
  const stranger = { id: "phone-signup", email: "60125550142@phone.sona.invalid" };
  expect((await hospitalOf(db, stranger).catch(e => e)).code).toBe("FORBIDDEN");
  expect(await db.select().from(hospitalMembers)).toHaveLength(0);
});

test("a member keeps their hospital; the seeded demo clinician joins the demo hospital on first use", async () => {
  const db = await createTestDb();
  await db.insert(hospitals).values([{ id: DEMO_HOSPITAL, name: "Demo" }, { id: "other", name: "Other" }]);
  await db.insert(hospitalMembers).values({ userId: "dr-other", hospitalId: "other" });
  expect(await hospitalOf(db, { id: "dr-other", email: "other@demo.test" })).toBe("other");
  expect(await hospitalOf(db, { id: "dr-test", email: "dr.test@sona.test" })).toBe(DEMO_HOSPITAL);
  expect((await db.select().from(hospitalMembers)).map(m => m.userId).sort()).toEqual(["dr-other", "dr-test"]);
});

test("a seeded test nurse joins the demo hospital as a nurse on first sign-in, and keeps that role", async () => {
  const db = await createTestDb();
  await db.insert(hospitals).values({ id: DEMO_HOSPITAL, name: "Demo" });
  const nurse = { id: "nurse-test", email: "Nurse.Test@sona.test" };
  expect(await memberOf(db, nurse)).toEqual({ hospitalId: DEMO_HOSPITAL, role: "nurse" });
  expect(await memberOf(db, nurse)).toEqual({ hospitalId: DEMO_HOSPITAL, role: "nurse" });
  expect(Object.values(DEMO_CLINICIANS).sort()).toEqual(["bed-manager", "doctor", "management", "nurse"]);
});
