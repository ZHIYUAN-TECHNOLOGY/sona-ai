import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { admissions, claims, hospitalMembers, hospitals } from "@sona-ai/db/schema/clinical";
import { DEMO_HOSPITAL } from "@sona-ai/db/demo";
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
    ["Bed 7", "Dayang Suhaila", "fit", "15:30", []],
    ["Bed 8", "Priya Nair", "fit", "13:00", []],
    ["Bed 9", "Ravi Kumar", "watch", "In 2 days", ["result"]],
    ["Bed 17", "Harjit Singh", "watch", "Tomorrow", ["result"]],
    ["Bed 1", "Hafizah Yusof", "watch", "Tomorrow", []],
    ["Bed 5", "Suresh Pillai", "watch", "Tomorrow", []],
    ["Bed 11", "Ganesan Muthu", "watch", "In 2 days", []],
    ["Bed 12", "Siti Aminah", "watch", "Tomorrow", []],
    ["Bed 13", "Wong Siew Ling", "watch", "Tomorrow", []],
    ["Bed 16", "Rosnah Ismail", "watch", "In 2 days", []],
    ["Bed 4", "Tan Ah Kow", "stable", "Awaiting rehab", ["transport"]],
    ["Bed 15", "Jimmy Anak Sali", "stable", "Awaiting angiogram", ["transport"]],
    ["Bed 3", "Chong Mei Yee", "stable", "In 2 days", []],
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
  // The fixture ward's blocked beds and bed-hours (3 blocked, about 9 bed-hours waiting); the seed's extra beds add one fit and ready (Bed 7) and block nothing.
  expect(wardSummary(beds)).toEqual({ beds: 17, fit: 5, blocked: 3, bedHours: 9 });
});

test("each bed's letter follows its own visit's claim, from the ward's one read of claims", async () => {
  const { db, api } = await signedIn();
  await db.insert(claims).values({ id: "claim-visit-2002", encounterId: "visit-2002", insurer: "Synthetic insurer", status: "sent", estimateCents: 1, codes: [] });
  const beds = await api.ward.beds();
  const letter = (bed: string) => beds.find(b => b.bed === bed)!.blockers.find(x => x.kind === "gl")?.detail;
  expect([letter("Bed 2"), letter("Bed 6")]).toEqual(["Sent · awaiting insurer", "Codes ready to review"]);
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

test("the bed forecast reads the live ward, its owners and the hospital's demo clock", async () => {
  const { db } = await signedIn();
  const api = createRouterClient(appRouter, { context: { db, session: as("dr-aisyah") as unknown as Session, now: () => new Date("2026-09-26T09:00:00+08:00") } });
  const f = await api.ward.forecast();
  expect(f.today).toEqual({ count: 6, byTime: "by 7 pm" });
  expect(f.tomorrow).toEqual({ count: 5 });
  expect(f.unlock).toMatchObject({ bed: "Bed 6", blockerId: "adm-1042-gl", owner: "Billing", owned: false, hours: 4 });
  // An owner on the server takes the unowned hour off, so Bed 2's letter becomes the one to chase.
  await api.ward.assignOwner({ blockerId: "adm-1042-gl", owner: "Billing" });
  expect((await api.ward.forecast()).unlock).toMatchObject({ bed: "Bed 2", blockerId: "adm-2002-gl" });
  // The demo clock jumps to 20:00: only the free beds are left today, the rest move to tomorrow.
  await db.update(hospitals).set({ clockOffsetMs: 11 * 3600_000 }).where(eq(hospitals.id, DEMO_HOSPITAL));
  expect(await api.ward.forecast()).toMatchObject({ today: { count: 3, byTime: "now" }, tomorrow: { count: 8 } });
});

test("unassigning a blocker clears its owner (the forecast counts it unowned again); it is idempotent and hospital-scoped", async () => {
  const { db, api, client } = await signedIn();
  await api.ward.assignOwner({ blockerId: "adm-1042-gl", owner: "Billing" });
  await db.insert(hospitals).values({ id: "other", name: "Other Hospital (synthetic)" });
  await db.insert(hospitalMembers).values({ userId: "dr-other", hospitalId: "other" });
  expect(await client("dr-other").ward.unassignOwner({ blockerId: "adm-1042-gl" })).toEqual({ blockerId: "adm-1042-gl", cleared: false });
  expect((await api.tasks.list()).map(t => t.owner)).toEqual(["Billing"]);
  expect(await api.ward.unassignOwner({ blockerId: "adm-1042-gl" })).toEqual({ blockerId: "adm-1042-gl", cleared: true });
  expect(await api.ward.unassignOwner({ blockerId: "adm-1042-gl" })).toEqual({ blockerId: "adm-1042-gl", cleared: false });
  expect(await api.tasks.list()).toEqual([]);
  // Assigning again after a clear makes a fresh owner task.
  expect((await api.ward.assignOwner({ blockerId: "adm-1042-gl", owner: "Nurse" })).owner).toBe("Nurse");
});
