import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { encounters, guaranteeLetters, hospitals, patients, tasks } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { doseKey } from "@sona-ai/domain/doses";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { Change } from "../events";
import { raiseMissedDoses } from "./doses";
import { appRouter } from "./index";

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

/** Amelia discharged Sat 26 Sep 15:40 and joined; the clock then moves to Mon 28 Sep 10:05. */
async function world() {
  const clock = { now: new Date("2026-09-26T15:40:00+08:00") };
  const db = await createTestDb();
  await seedDemo(db, clock.now);
  await addClinician(db, "dr-aisyah");
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: clock.now }).where(eq(guaranteeLetters.id, "gl-1042"));
  await db.update(encounters).set({ state: { discharge: { glReceived: true, medsConfirmed: true, followUp: "2w", language: "ms" } } }).where(eq(encounters.id, "visit-1042"));
  const heard: Change[] = [];
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), now: () => clock.now, announce: async (_h, c) => { heard.push(c); } } });
  const doctor = as("dr-aisyah"), amelia = as("amelia-account");
  await doctor.discharge.request({ encounterId: "visit-1042", requestId: "req-d1", approvedBy: "dr-aisyah" });
  await amelia.care.join({ code: (await doctor.care.code({ encounterId: "visit-1042" })).code });
  clock.now = new Date("2026-09-28T10:05:00+08:00");
  return { db, doctor, amelia, heard };
}

test("her hold to take reaches the care team: the day-1 dose she skipped reads as missed, today's as late", async () => {
  const { doctor, amelia, heard } = await world();
  const plan = await amelia.care.discharge();
  if (plan.status !== "discharged") throw new Error("not discharged");
  const timed = [...plan.medicines.new, ...plan.medicines.changed, ...plan.medicines.continue].filter(m => m.at?.length);
  expect(timed.length).toBeGreaterThan(0);

  const before = await doctor.adherence.get({ patientId: "SYN-1042" });
  expect(before.taken).toBe(0);
  expect(before.missed.length).toBeGreaterThan(0);
  expect(before.line).toMatch(/missed/);

  // She marks every dose due so far taken except the first one; marking again changes nothing.
  const all = (await doctor.adherence.get({ patientId: "SYN-1042" }));
  const keys = [...all.missed, ...all.late].map(d => doseKey(d.name, new Date(d.dueAt))).sort();
  for (const k of keys.slice(1)) await amelia.care.doses.take({ key: k });
  await amelia.care.doses.take({ key: keys[1]! });
  expect((await amelia.care.doses.list()).sort()).toEqual(keys.slice(1));
  expect(heard).toContainEqual({ topic: "doses", patientId: "SYN-1042" });

  const after = await doctor.adherence.get({ patientId: "SYN-1042" });
  expect(after.taken).toBe(keys.length - 1);
  expect(after.missed.length + after.late.length).toBe(1);
});

test("a key that is not one of her doses is refused, and another hospital cannot read her adherence", async () => {
  const { db, doctor, amelia } = await world();
  for (const key of ["Azithromycin@2026-09-27T03:00:00.000Z", "Warfarin@2026-09-27T00:00:00.000Z", "nonsense"])
    expect((await amelia.care.doses.take({ key }).catch(e => e)).code).toBe("BAD_REQUEST");
  await db.insert(hospitals).values({ id: "other", name: "Other" });
  await addClinician(db, "dr-other", "other");
  const other = createRouterClient(appRouter, { context: { db, session: user("dr-other") } });
  expect((await other.adherence.get({ patientId: "SYN-1042" }).catch(e => e)).code).toBe("NOT_FOUND");
  expect((await doctor.adherence.get({ patientId: (await db.select().from(patients))[0]!.id })).due).toBeGreaterThanOrEqual(0);
});

test("a missed dose puts one row on My Day: it follows the count, clears when she takes a dose, and returns only for a new miss", async () => {
  const { db, amelia } = await world();
  const doseTasks = () => db.select().from(tasks).where(eq(tasks.kind, "dose"));
  const at = (iso: string) => new Date(iso);

  // Mon 10:05: the doses she skipped since Saturday read as missed, so the attending doctor gets one row.
  expect(await raiseMissedDoses(db, "demo", at("2026-09-28T10:05:00+08:00"))).toEqual(["SYN-1042"]);
  const [first] = await doseTasks();
  expect(first).toMatchObject({ encounterId: "visit-1042", owner: "Attending doctor", due: "Today", completed: false });
  expect(first!.title).toMatch(/^Amelia: .*missed/);
  // The same hour again changes nothing.
  expect(await raiseMissedDoses(db, "demo", at("2026-09-28T10:05:00+08:00"))).toEqual([]);

  // The next morning more doses have slipped past: the same row, its count updated.
  expect(await raiseMissedDoses(db, "demo", at("2026-09-29T08:00:00+08:00"))).toEqual(["SYN-1042"]);
  const rows = await doseTasks();
  expect(rows.length).toBe(1);
  expect(rows[0]!.title).not.toBe(first!.title);

  // She takes a dose: back on track, the row leaves My Day and the next check does not raise it again.
  const plan = await amelia.care.discharge();
  if (plan.status !== "discharged") throw new Error("not discharged");
  const med = [...plan.medicines.new, ...plan.medicines.changed, ...plan.medicines.continue].find(m => m.at?.length)!;
  const [hh, mm] = med.at![0]!.split(":");
  await amelia.care.doses.take({ key: doseKey(med.name, at(`2026-09-28T${hh}:${mm}:00+08:00`)) });
  expect((await doseTasks()).every(t => t.completed)).toBe(true);
  expect(await raiseMissedDoses(db, "demo", at("2026-09-29T08:00:00+08:00"))).toEqual([]);
});
