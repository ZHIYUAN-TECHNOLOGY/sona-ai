import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { encounters, guaranteeLetters } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { Change } from "../events";
import { reasonOf, tomorrowNine } from "./check-ins";
import { appRouter } from "./index";

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

test("tomorrow 09:00 is counted in Kuala Lumpur, and the reason is the patient's words", () => {
  expect(tomorrowNine(new Date("2026-09-28T23:30:00+08:00")).toISOString()).toBe(new Date("2026-09-29T09:00:00+08:00").toISOString());
  expect(reasonOf("Amelia: fever returned after discharge")).toBe("fever returned");
  expect(reasonOf("Amelia: ")).toBe("follow-up");
});

test("Book in on Amelia's flagged reply books tomorrow 09:00, closes the flag, and her Sona Care hears it and shows it first", async () => {
  const now = new Date("2026-09-28T10:05:00+08:00");
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T15:40:00+08:00"));
  await addClinician(db, "dr-aisyah");
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: now }).where(eq(guaranteeLetters.id, "gl-1042"));
  await db.update(encounters).set({ state: { discharge: { glReceived: true, medsConfirmed: true, followUp: "2w", language: "ms" } } }).where(eq(encounters.id, "visit-1042"));
  const heard: Change[] = [];
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), now: () => now, announce: async (_h, c) => { heard.push(c); } } });
  const doctor = as("dr-aisyah"), amelia = as("amelia-account");
  await doctor.discharge.request({ encounterId: "visit-1042", requestId: "req-d1", approvedBy: "dr-aisyah" });
  await amelia.care.join({ code: (await doctor.care.code({ encounterId: "visit-1042" })).code });
  const flagged = (await amelia.care.checkIns.reply({ checkInId: "check-in:visit-1042:2", text: "demam balik" })).replies[0]!.task!;

  const booked = await doctor.checkIns.bookIn({ taskId: flagged.id });
  expect(booked).toMatchObject({ kind: "Clinic review · fever returned", patientId: "SYN-1042", startsAt: new Date("2026-09-29T09:00:00+08:00") });
  expect(heard).toContainEqual({ topic: "checkIns", patientId: "SYN-1042" });
  expect((await doctor.tasks.list()).find(t => t.id === flagged.id)?.completed).toBe(true);
  // Her Schedule and home read it as the next thing, ahead of the two-week review.
  expect((await amelia.care.followUps())[0]).toMatchObject({ title: "Clinic review · fever returned" });
  // A second tap returns the same booking.
  expect((await doctor.checkIns.bookIn({ taskId: flagged.id })).appointmentId).toBe(booked.appointmentId);
  // Only a check-in flag can be booked this way, and only the hospital's own.
  expect((await doctor.checkIns.bookIn({ taskId: "nope" }).catch(e => e)).code).toBe("NOT_FOUND");
});

test("Book in offers her untracked X-ray findings; adding one puts its test on the same visit and her Sona Care shows it", async () => {
  const now = new Date("2026-09-28T10:05:00+08:00");
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T15:40:00+08:00"));
  await addClinician(db, "dr-aisyah");
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: now }).where(eq(guaranteeLetters.id, "gl-1042"));
  await db.update(encounters).set({ state: { discharge: { glReceived: true, medsConfirmed: true, followUp: "2w", language: "ms" } } }).where(eq(encounters.id, "visit-1042"));
  const heard: Change[] = [];
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), now: () => now, announce: async (_h, c) => { heard.push(c); } } });
  const doctor = as("dr-aisyah"), amelia = as("amelia-account");
  await doctor.discharge.request({ encounterId: "visit-1042", requestId: "req-d1", approvedBy: "dr-aisyah" });
  await amelia.care.join({ code: (await doctor.care.code({ encounterId: "visit-1042" })).code });
  const detected = await doctor.findings.detect({ encounterId: "visit-1042" });
  const flagged = (await amelia.care.checkIns.reply({ checkInId: "check-in:visit-1042:2", text: "demam balik" })).replies[0]!.task!;

  const booked = await doctor.checkIns.bookIn({ taskId: flagged.id });
  const nodule = detected.find(f => f.kind === "nodule")!;
  expect(booked.toAdd.map(f => f.id)).toContain(nodule.id);
  expect(booked.toAdd.find(f => f.id === nodule.id)?.test).toBe("CT chest");

  const added = await doctor.findings.addToVisit({ findingId: nodule.id, appointmentId: booked.appointmentId });
  expect(added).toMatchObject({ test: "CT chest", startsAt: booked.startsAt });
  expect(heard).toContainEqual({ topic: "findings", patientId: "SYN-1042" });
  // On her phone: the CT scan on the same morning as the review.
  const same = (await amelia.care.followUps()).filter(f => new Date(f.date).getTime() === new Date(booked.startsAt).getTime()).map(f => f.title);
  expect(same).toEqual(expect.arrayContaining(["Clinic review · fever returned", "CT scan of your chest"]));
  // Booking in again no longer offers it; adding it again changes nothing.
  expect((await doctor.checkIns.bookIn({ taskId: flagged.id })).toAdd.map(f => f.id)).not.toContain(nodule.id);
  expect((await doctor.findings.addToVisit({ findingId: nodule.id, appointmentId: booked.appointmentId })).recallId).toBe(added.recallId);
  expect((await doctor.findings.addToVisit({ findingId: nodule.id, appointmentId: "nope" }).catch(e => e)).code).toBe("NOT_FOUND");
});

test("the ops counter counts the week's loops from their rows: bed time, flags acted on, flag-to-booked time, check-ins answered, follow-ups", async () => {
  const clock = { now: new Date("2026-09-26T15:40:00+08:00") };
  const db = await createTestDb();
  await seedDemo(db, clock.now);
  await addClinician(db, "dr-aisyah");
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: clock.now }).where(eq(guaranteeLetters.id, "gl-1042"));
  await db.update(encounters).set({ state: { discharge: { glReceived: true, medsConfirmed: true, followUp: "2w", language: "ms" } } }).where(eq(encounters.id, "visit-1042"));
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), now: () => clock.now } });
  const doctor = as("dr-aisyah"), amelia = as("amelia-account");
  const empty = await doctor.ops.get();
  expect([empty.bedMinutesSaved, empty.redFlags, empty.checkInsSent, empty.medianMinutesToBook]).toEqual([0, 0, 0, null]);

  await doctor.discharge.request({ encounterId: "visit-1042", requestId: "req-d1", approvedBy: "dr-aisyah" });
  await amelia.care.join({ code: (await doctor.care.code({ encounterId: "visit-1042" })).code });
  await doctor.findings.detect({ encounterId: "visit-1042" });
  clock.now = new Date("2026-09-28T10:05:00+08:00");
  const flagged = (await amelia.care.checkIns.reply({ checkInId: "check-in:visit-1042:2", text: "demam balik" })).replies[0]!.task!;
  clock.now = new Date("2026-09-28T10:16:00+08:00");
  const booked = await doctor.checkIns.bookIn({ taskId: flagged.id });
  await doctor.findings.addToVisit({ findingId: booked.toAdd[0]!.id, appointmentId: booked.appointmentId });

  const ops = await doctor.ops.get();
  expect(ops.bedMinutesSaved).toBe(250); // the discharge receipt's minutes saved against the synthetic typical wait
  expect([ops.discharges, ops.redFlags, ops.redFlagsActedOn, ops.medianMinutesToBook]).toEqual([1, 1, 1, 11]);
  expect([ops.checkInsSent, ops.checkInsAnswered]).toEqual([1, 1]);
  expect([ops.lostFollowUps, ops.trackedFollowUps]).toEqual([0, 1]);
  expect(ops.dosesDue).toBeGreaterThan(0);
});
