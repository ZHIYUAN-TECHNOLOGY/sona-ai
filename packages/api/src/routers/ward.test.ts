import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { admissions, hospitalMembers, hospitals } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { wardSummary } from "@sona-ai/domain/ward";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { appRouter } from "./index";

const as = (id: string, signed = true) => ({
  user: { id, name: "Dr Aisyah", email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
  signed,
});

async function signedIn(signed = true) {
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T09:00:00+08:00"));
  await addClinician(db, "dr-aisyah");
  const client = (id: string) => createRouterClient(appRouter, { context: { db, session: signed ? as(id) as unknown as Session : null } });
  return { db, api: client("dr-aisyah"), client };
}

test("the live ward is every bed the app draws, fit beds first and the most blocked leading, each blocker from its rows", async () => {
  const { api } = await signedIn();
  const beds = await api.ward.beds();
  expect(beds.map(b => [b.bed, b.name, b.status, b.predicted, b.blockers.map(x => x.kind)])).toEqual([
    ["Bed 6", "Amelia Tan", "fit", "Once cleared", ["gl", "pharmacy", "booking"]],
    ["Bed 2", "Nurul Huda", "fit", "11:00", ["gl", "result"]],
    ["Bed 14", "Lim Wei Jie", "fit", "14:30", ["pharmacy", "transport"]],
    ["Bed 8", "Priya Nair", "fit", "13:00", []],
    ["Bed 9", "Ravi Kumar", "watch", "In 2 days", ["result"]],
    ["Bed 12", "Siti Aminah", "watch", "Tomorrow", []],
    ["Bed 4", "Tan Ah Kow", "stable", "Awaiting rehab", ["transport"]],
    ["Bed 10", undefined, "empty", "Cleaning · ready 12:30", []],
  ]);
  expect(beds.find(b => b.bed === "Bed 2")).toMatchObject({
    admissionId: "adm-2002", patientId: "SYN-2002", initials: "NH", meta: "29 · Female", waitingHours: 5,
    sbar: { s: "Day 3 of antibiotics for pyelonephritis.", r: "Discharge once the final GL and sensitivities are in." },
    blockers: [
      { id: "adm-2002-gl", kind: "gl", label: "Final guarantee letter", detail: "Codes ready to review" },
      { id: "adm-2002-result-lab-2002-b2-result", kind: "result", label: "Urine culture sensitivities", detail: "Pending" },
    ],
  });
  expect(beds.find(b => b.bed === "Bed 14")!.blockers[1]).toEqual({ id: "adm-2014-transport", kind: "transport", label: "Ride home", detail: "Family free after 17:00" });
  // The same summary the fixture ward gives: 4 fit, 3 blocked, about 9 bed-hours waiting.
  expect(wardSummary(beds)).toEqual({ beds: 8, fit: 4, blocked: 3, bedHours: 9 });
});

test("once Amelia is discharged, bed 6 shows as freed", async () => {
  const { db, api } = await signedIn();
  await db.update(admissions).set({ dischargedAt: new Date() }).where(eq(admissions.id, "adm-1042"));
  expect((await api.ward.beds()).find(b => b.bed === "Bed 6")).toMatchObject({ status: "free", predicted: "Free · cleaning next", blockers: [] });
});

test("any bed's blocker can take an owner on the server", async () => {
  const { api } = await signedIn();
  await api.ward.assignOwner({ blockerId: "adm-2014-transport", owner: "Porter" });
  await api.ward.assignOwner({ blockerId: "adm-2002-result-lab-2002-b2-result", owner: "Nurse" });
  expect((await api.tasks.list()).map(t => [t.sourceId, t.owner, t.title]).sort()).toEqual([
    ["adm-2002-result-lab-2002-b2-result", "Nurse", "Bed 2: Urine culture sensitivities"],
    ["adm-2014-transport", "Porter", "Bed 14: Ride home"],
  ]);
});

test("the ward needs a signed-in doctor, and another hospital sees none of the demo ward", async () => {
  expect((await (await signedIn(false)).api.ward.beds().catch(e => e)).code).toBe("UNAUTHORIZED");
  const { db, client } = await signedIn();
  await db.insert(hospitals).values({ id: "other", name: "Other Hospital (synthetic)" });
  await db.insert(hospitalMembers).values({ userId: "dr-other", hospitalId: "other" });
  expect(await client("dr-other").ward.beds()).toEqual([]);
});
