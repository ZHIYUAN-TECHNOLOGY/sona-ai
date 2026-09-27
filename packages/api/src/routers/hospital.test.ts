import { hospitalMembers, hospitals } from "@sona-ai/db/schema/clinical";
import { DEMO_CLINICIANS, DEMO_HOSPITAL } from "@sona-ai/db/demo";
import { createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";

import { hospitalOf } from "./hospital";

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
  expect(await hospitalOf(db, { id: "dr-test", email: DEMO_CLINICIANS[0]! })).toBe(DEMO_HOSPITAL);
  expect((await db.select().from(hospitalMembers)).map(m => m.userId).sort()).toEqual(["dr-other", "dr-test"]);
});
