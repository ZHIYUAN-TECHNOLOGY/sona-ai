import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { user } from "@sona-ai/db/schema/auth";
import { accessLogs, hospitals } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";

import { requireAuth } from "./index";
import { PERMISSIONS, needs, refusal, type Role } from "./roles";
import { appRouter } from "./routers/index";

const session = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

async function world() {
  const db = await createTestDb();
  const clock = { now: new Date("2026-09-26T10:00:00+08:00") };
  await seedDemo(db, clock.now);
  await db.insert(hospitals).values({ id: "other", name: "Other" });
  const roles: Role[] = ["doctor", "nurse", "bed-manager", "management"];
  for (const role of roles) await addClinician(db, role, undefined, role);
  await addClinician(db, "dr-other", "other");
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: session(id), now: () => clock.now } });
  return { db, clock, doctor: as("doctor"), nurse: as("nurse"), beds: as("bed-manager"), manager: as("management"), other: as("dr-other"), as };
}
const codeOf = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code);

test("every clinician route is in the permission table (an unlisted route would be refused for everyone)", () => {
  const unlisted: string[] = [];
  const walk = (node: object, path: string[]) => {
    for (const [key, value] of Object.entries(node)) {
      const def = (value as { "~orpc"?: { middlewares: unknown[] } })["~orpc"];
      if (def) { if (def.middlewares.includes(requireAuth) && !PERMISSIONS[[...path, key].join(".")]) unlisted.push([...path, key].join(".")); }
      else if (value && typeof value === "object") walk(value, [...path, key]);
    }
  };
  walk(appRouter, []);
  expect(unlisted).toEqual([]);
  expect(refusal("doctor", "made.up")).toBe("This isn't open to any role yet.");
});

test("the refusal says who can do it, in plain words", () => {
  expect(refusal("nurse", "discharge.request")).toBe("Nurses can't approve a discharge. Ask the attending doctor.");
  expect(refusal("bed-manager", "note.get")).toBe("Bed managers can't read the note. Ask a doctor, a nurse or management.");
  expect(refusal("management", "messages.reply")).toBe("Management can't reply to a care message. Ask a doctor or a nurse.");
  expect(refusal("doctor", "discharge.request")).toBeUndefined();
  expect(needs("prescribing.simulate")).toBe("Needs a doctor");
});

test("a nurse reads and handles care, but cannot prescribe, approve a discharge, send a claim, decide a finding or see the coding audit", async () => {
  const { nurse } = await world();
  expect(await codeOf(nurse.messages.list({ patientId: "SYN-1042" }))).toBe("OK");
  expect(await codeOf(nurse.ward.assignOwner({ blockerId: "adm-1042-gl", owner: "Billing" }))).toBe("OK");
  expect(await codeOf(nurse.handover.list())).toBe("OK");
  const denied = await nurse.discharge.request({ encounterId: "visit-1042", requestId: "r1", approvedBy: "nurse" }).catch(e => e);
  expect([denied.code, denied.message]).toEqual(["FORBIDDEN", "Nurses can't approve a discharge. Ask the attending doctor."]);
  for (const call of [
    nurse.prescribing.simulate({ encounterId: "visit-1042", requestId: "p1", approvedBy: "nurse" }),
    nurse.claim.send({ encounterId: "visit-1042", requestId: "c1", approvedBy: "nurse" }),
    nurse.findings.dismiss({ findingId: "f1", reason: "x" }),
    nurse.audit.list(),
    nurse.accessLog.list({ patientId: "SYN-1042" }),
  ]) expect(await codeOf(call)).toBe("FORBIDDEN");
});

test("a bed manager runs the ward but never opens clinical notes; management sees the numbers and audit but writes nothing clinical", async () => {
  const { beds, manager } = await world();
  expect(await codeOf(beds.ward.beds())).toBe("OK");
  expect(await codeOf(beds.ward.assignOwner({ blockerId: "adm-1042-gl", owner: "Billing" }))).toBe("OK");
  expect(await codeOf(beds.claim.status({ encounterId: "visit-1042" }))).toBe("OK");
  expect(await codeOf(beds.note.get({ encounterId: "visit-1042" }))).toBe("FORBIDDEN");
  expect(await codeOf(beds.prescribing.review({ encounterId: "visit-1042", expectedRevision: 1 }))).toBe("FORBIDDEN");

  expect(await codeOf(manager.ops.get())).toBe("OK");
  expect(await codeOf(manager.audit.list())).toBe("OK");
  expect(await codeOf(manager.note.get({ encounterId: "visit-1042" }))).toBe("OK");
  expect(await codeOf(manager.accessLog.list({ patientId: "SYN-1042" }))).toBe("OK");
  expect(await codeOf(manager.note.save({ encounterId: "visit-1042", expectedRevision: 1, sentences: [] }))).toBe("FORBIDDEN");
  expect(await codeOf(manager.ward.assignOwner({ blockerId: "adm-1042-gl", owner: "Billing" }))).toBe("FORBIDDEN");
  expect(await manager.clinician.me()).toMatchObject({ role: "management", label: "Management" });
});

test("reads and writes naming a patient or visit are logged (the visit resolved to its patient); others and refusals are not", async () => {
  const { db, doctor, beds } = await world();
  await doctor.encounter.get({ encounterId: "visit-1042" });
  await doctor.messages.list({ patientId: "SYN-1042" });
  await doctor.tasks.list();
  await beds.note.get({ encounterId: "visit-1042" }).catch(() => {});
  const rows = await db.select().from(accessLogs);
  expect(rows.map(r => [r.userId, r.patientId, r.encounterId, r.route, r.hospitalId])).toEqual([
    ["doctor", "SYN-1042", "visit-1042", "encounter.get", "demo"],
    ["doctor", "SYN-1042", null, "messages.list", "demo"],
  ]);
  expect(rows[0]!.at.toISOString()).toBe("2026-09-26T02:00:00.000Z");
});

test("in the Worker the trail is written after the answer (waitUntil), not before it", async () => {
  const { db } = await world();
  const later: Promise<unknown>[] = [];
  const doctor = createRouterClient(appRouter, { context: { db, session: session("doctor"), waitUntil: promise => { later.push(promise); } } });
  await doctor.encounter.get({ encounterId: "visit-1042" });
  expect(later).toHaveLength(1);
  await Promise.all(later);
  expect((await db.select().from(accessLogs)).map(r => [r.userId, r.patientId, r.route])).toEqual([["doctor", "SYN-1042", "encounter.get"]]);
});

test("Sona Care's own routes never write the clinician access trail", async () => {
  const { db, doctor, as } = await world();
  const { code } = await doctor.care.code({ encounterId: "visit-1042" });
  const amelia = as("amelia-account");
  await amelia.care.join({ code });
  await amelia.care.me();
  await amelia.care.messages.list();
  const routes = (await db.select().from(accessLogs)).map(r => r.route);
  expect(routes).toEqual(["care.code"]);
});

test("the trail is hospital-scoped, newest first, names who, and collapses back-to-back reads", async () => {
  const { db, doctor, manager, other, clock } = await world();
  await db.insert(user).values([{ id: "doctor", name: "Dr Test Aisyah", email: "dr.test@sona.test" }, { id: "management", name: "Test Manager Farah", email: "manager.test@sona.test" }]);
  await doctor.encounter.get({ encounterId: "visit-1042" });
  clock.now = new Date(clock.now.getTime() + 60_000);
  await doctor.encounter.get({ encounterId: "visit-1042" });
  clock.now = new Date(clock.now.getTime() + 60_000);
  await manager.note.get({ encounterId: "visit-1042" });
  const trail = await manager.accessLog.list({ patientId: "SYN-1042" });
  expect(trail.lines.map(t => [t.who, t.did, t.times])).toEqual([["Test Manager Farah", "opened the note", 1], ["Dr Test Aisyah", "opened the visit", 2]]);
  expect((await other.accessLog.list({ patientId: "SYN-1042" })).lines).toEqual([]);
});

test("reassigning a task is for hands-on care; clearing a blocker owner is for the ward roles", async () => {
  const { doctor, nurse, beds, manager } = await world();
  const task = await doctor.tasks.create({ encounterId: "visit-1042", title: "Review", owner: "Clinic nurse", requestId: "r-upd" });
  expect(await codeOf(nurse.tasks.update({ taskId: task.id, owner: "Pharmacist" }))).toBe("OK");
  expect(await codeOf(beds.tasks.update({ taskId: task.id, owner: "Porter" }))).toBe("FORBIDDEN");
  expect(await codeOf(manager.tasks.update({ taskId: task.id, due: "2026-10-01" }))).toBe("FORBIDDEN");
  expect(await codeOf(beds.ward.unassignOwner({ blockerId: "adm-1042-gl" }))).toBe("OK");
  expect(await codeOf(manager.ward.unassignOwner({ blockerId: "adm-1042-gl" }))).toBe("FORBIDDEN");
  expect(needs("tasks.update")).toBe("Needs a doctor or a nurse");
});
