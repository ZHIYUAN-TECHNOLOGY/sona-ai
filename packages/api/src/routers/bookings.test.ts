import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { doctors, encounters, guaranteeLetters, hospitals } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { DOCTORS } from "@sona-ai/domain/doctors";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { Change } from "../events";
import { appRouter } from "./index";

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

// Monday 28 Sep 2026, 10:05 in Kuala Lumpur; Dr. Lim holds clinic Mon, Wed and Thu.
const now = new Date("2026-09-28T10:05:00+08:00");
const THU_1030 = new Date("2026-10-01T10:30:00+08:00");

async function setup() {
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
  return { db, heard, as, doctor, amelia };
}

test("slots: a care-team doctor's clinic times from tomorrow for two weeks, minus booked visits and held requests", async () => {
  const { doctor, amelia } = await setup();
  const lim = await doctor.bookings.slots();
  expect(lim.doctor.id).toBe("lim");
  expect(lim.careTeam.map(d => d.id)).toEqual(["lim", "priya"]);
  expect(lim.days[0]!.times[0]).toEqual(new Date("2026-09-30T09:00:00+08:00")); // Tue is not a Lim day
  expect(lim.days.every(d => d.times.every(t => t > now && t.getTime() < now.getTime() + 15 * 86_400_000))).toBe(true);
  const priya = await doctor.bookings.slots({ doctorId: "priya" });
  expect(priya.days[0]!.times[0]).toEqual(new Date("2026-09-29T09:30:00+08:00"));

  await amelia.care.bookings.request({ doctorId: "lim", startsAt: THU_1030 });
  const after = (await doctor.bookings.slots()).days.flatMap(d => d.times).map(t => t.getTime());
  expect(after).not.toContain(THU_1030.getTime());
  // The patient's directory reads the same free slots.
  const fromCare = (await amelia.care.doctors.get({ id: "lim" })).nextSlots.flatMap(d => d.times).map(t => t.getTime());
  expect(fromCare).toEqual(after);
  expect((await amelia.care.doctors.list()).map(d => d.id).sort()).toEqual(DOCTORS.map(d => d.id).sort());
});

test("an appointment holds only its own doctor's slot: Book in with Dr. Lim leaves Dr. Priya free at the same time", async () => {
  const { db, doctor, amelia } = await setup();
  const WED_0900 = new Date("2026-09-30T09:00:00+08:00"); // Wednesday 09:00, once Dr. Priya holds clinic then too
  const free = async (id: string) => (await amelia.care.doctors.get({ id })).nextSlots.flatMap(d => d.times).map(t => t.getTime());
  await db.update(doctors).set({ days: [1, 2, 3, 4, 5], times: ["09:00"] }).where(eq(doctors.id, "priya"));
  expect(await free("priya")).toContain(WED_0900.getTime());
  expect(await free("lim")).toContain(WED_0900.getTime());
  const flagged = (await amelia.care.checkIns.reply({ checkInId: "check-in:visit-1042:2", text: "demam balik" })).replies[0]!.task!;
  await doctor.checkIns.bookIn({ taskId: flagged.id, startsAt: WED_0900, doctorId: "lim" });
  expect(await free("lim")).not.toContain(WED_0900.getTime());
  expect(await free("priya")).toContain(WED_0900.getTime());
  // A replay without a doctor keeps Dr. Lim's hold.
  await doctor.checkIns.bookIn({ taskId: flagged.id });
  expect(await free("lim")).not.toContain(WED_0900.getTime());
});

test("Book in at a chosen slot with a doctor; it must be in the next 30 days; a new time moves the same visit", async () => {
  const { doctor, amelia } = await setup();
  const flagged = (await amelia.care.checkIns.reply({ checkInId: "check-in:visit-1042:2", text: "demam balik" })).replies[0]!.task!;
  expect((await doctor.checkIns.bookIn({ taskId: flagged.id, startsAt: new Date("2026-09-28T09:00:00+08:00") }).catch(e => e)).code).toBe("BAD_REQUEST");
  expect((await doctor.checkIns.bookIn({ taskId: flagged.id, startsAt: new Date("2026-11-02T09:00:00+08:00") }).catch(e => e)).code).toBe("BAD_REQUEST");
  expect((await doctor.checkIns.bookIn({ taskId: flagged.id, startsAt: THU_1030, doctorId: "nope" }).catch(e => e)).code).toBe("NOT_FOUND");

  const booked = await doctor.checkIns.bookIn({ taskId: flagged.id, startsAt: THU_1030.toISOString(), doctorId: "lim" });
  expect(booked).toMatchObject({ startsAt: THU_1030, kind: "Clinic review · fever returned · Dr. Lim" });
  expect((await amelia.care.followUps())[0]).toMatchObject({ title: "Clinic review · fever returned · Dr. Lim", date: THU_1030 });
  // A replay without a time keeps it; a new time moves the same appointment.
  expect((await doctor.checkIns.bookIn({ taskId: flagged.id })).startsAt).toEqual(THU_1030);
  const detected = await doctor.findings.detect({ encounterId: "visit-1042" });
  const nodule = detected.find(f => f.kind === "nodule")!;
  await doctor.findings.addToVisit({ findingId: nodule.id, appointmentId: booked.appointmentId });
  const WED_0900 = new Date("2026-09-30T09:00:00+08:00");
  const moved = await doctor.checkIns.bookIn({ taskId: flagged.id, startsAt: WED_0900, doctorId: "lim" });
  expect(moved.appointmentId).toBe(booked.appointmentId);
  expect(moved.startsAt).toEqual(WED_0900);
  // The CT put on the same trip moved with it.
  expect(moved.toAdd.map(f => f.id)).not.toContain(nodule.id);
  const same = (await amelia.care.followUps()).filter(f => f.date.getTime() === WED_0900.getTime()).map(f => f.title);
  expect(same).toEqual(expect.arrayContaining(["Clinic review · fever returned · Dr. Lim", "CT scan of your chest"]));
});

test("a request becomes a care-team task; confirm puts the visit on her Schedule; replays change nothing", async () => {
  const { doctor, amelia, heard } = await setup();
  const asked = await amelia.care.bookings.request({ doctorId: "lim", startsAt: THU_1030, reason: "still coughing" });
  expect(asked).toMatchObject({ status: "requested", title: "Amelia asks to see Dr. Lim · Thu 10:30", doctorName: "Dr. Lim Wei Jie", reason: "still coughing" });
  expect(heard).toContainEqual({ topic: "bookings", patientId: "SYN-1042" });
  // A replay returns the same request; nobody else can take the slot meanwhile.
  expect((await amelia.care.bookings.request({ doctorId: "lim", startsAt: THU_1030 })).id).toBe(asked.id);
  expect((await doctor.tasks.list()).filter(t => t.kind === "booking")).toMatchObject([{ id: asked.taskId, owner: "Care team", completed: false, encounterId: "visit-1042" }]);
  expect((await amelia.care.bookings.request({ doctorId: "lim", startsAt: new Date("2026-10-01T11:00:00+08:00") }).catch(e => e)).code).toBe("CONFLICT");
  expect((await doctor.bookings.list()).map(r => r.id)).toEqual([asked.id]);

  heard.length = 0;
  const confirmed = await doctor.bookings.decide({ requestId: asked.id, decision: "confirm" });
  expect(confirmed).toMatchObject({ status: "confirmed", appointmentId: `visit:${asked.id}` });
  expect(heard).toContainEqual({ topic: "bookings", patientId: "SYN-1042" });
  expect((await amelia.care.followUps())[0]).toMatchObject({ title: "Visit: Dr. Lim, Respiratory", date: THU_1030 });
  expect((await doctor.tasks.list()).find(t => t.id === asked.taskId)?.completed).toBe(true);
  expect(await doctor.bookings.list()).toEqual([]);
  // Deciding again returns it as it was: no second visit, no decline over a confirm.
  expect((await doctor.bookings.decide({ requestId: asked.id, decision: "decline" })).status).toBe("confirmed");
  expect((await amelia.care.followUps()).filter(f => f.id === `visit:${asked.id}`)).toHaveLength(1);
  expect((await amelia.care.bookings.list()).map(r => r.status)).toEqual(["confirmed"]);
});

test("decline closes the task, sends the note to her thread and frees the slot", async () => {
  const { doctor, amelia } = await setup();
  const asked = await amelia.care.bookings.request({ doctorId: "lim", startsAt: THU_1030 });
  const declined = await doctor.bookings.decide({ requestId: asked.id, decision: "decline", note: "Dr. Lim is away that week. Wednesday 9:00 works." });
  expect(declined).toMatchObject({ status: "declined", note: "Dr. Lim is away that week. Wednesday 9:00 works." });
  expect((await amelia.care.messages.list()).at(-1)).toMatchObject({ from: "care-team", text: "Dr. Lim is away that week. Wednesday 9:00 works." });
  expect((await amelia.care.bookings.list())[0]).toMatchObject({ status: "declined", note: declined.note });
  expect((await amelia.care.doctors.get({ id: "lim" })).nextSlots.flatMap(d => d.times).map(t => t.getTime())).toContain(THU_1030.getTime());
  expect((await amelia.care.followUps()).some(f => f.id === `visit:${asked.id}`)).toBe(false);
  // Without a note, she is still told why.
  const again = await amelia.care.bookings.request({ doctorId: "lim", startsAt: new Date("2026-10-05T09:00:00+08:00") });
  expect((await doctor.bookings.decide({ requestId: again.id, decision: "decline" })).note).toBe("Sorry, Dr. Lim can't see you on Mon 5 Oct at 09:00. Please choose another time.");
});

test("booking stays inside the hospital: other clinicians, other doctors and other patients are refused", async () => {
  const { db, as, amelia } = await setup();
  await db.insert(hospitals).values({ id: "other", name: "Other Hospital (synthetic)" });
  await db.insert(doctors).values({ ...DOCTORS[0]!, id: "elsewhere", hospitalId: "other", careTeam: true });
  await addClinician(db, "dr-other", "other");
  const other = as("dr-other");
  const asked = await amelia.care.bookings.request({ doctorId: "lim", startsAt: THU_1030 });
  expect(await other.bookings.list()).toEqual([]);
  expect((await other.bookings.decide({ requestId: asked.id, decision: "confirm" }).catch(e => e)).code).toBe("NOT_FOUND");
  expect((await other.bookings.slots()).doctor.id).toBe("elsewhere");
  expect((await other.bookings.slots({ doctorId: "lim" }).catch(e => e)).code).toBe("NOT_FOUND");
  expect((await amelia.care.doctors.get({ id: "elsewhere" }).catch(e => e)).code).toBe("NOT_FOUND");
  expect((await amelia.care.bookings.request({ doctorId: "elsewhere", startsAt: THU_1030 }).catch(e => e)).code).toBe("NOT_FOUND");
  expect((await amelia.care.doctors.list()).some(d => d.id === "elsewhere")).toBe(false);
  // A clinician account is not a patient account.
  expect((await other.care.bookings.list().catch(e => e)).code).toBe("FORBIDDEN");
});
