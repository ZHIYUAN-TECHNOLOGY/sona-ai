import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { encounters, guaranteeLetters, tasks } from "@sona-ai/db/schema/clinical";
import { DEMO_HOSPITAL, seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { Context } from "../context";
import type { Change } from "../events";
import { stubModels, type Models } from "../models";
import { appRouter } from "../routers/index";
import { tellCareTeam } from "./care-team";

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

/** Amelia discharged in Malay (check-ins on day 2 and day 7), now on day 2 at noon; Gemma reads replies as `label`. */
async function world(label: "fine" | "worse" | "urgent") {
  const now = new Date("2026-09-28T12:00:00+08:00");
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T15:40:00+08:00"));
  await addClinician(db, "dr-aisyah");
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: now }).where(eq(guaranteeLetters.id, "gl-1042"));
  await db.update(encounters).set({ state: { discharge: { glReceived: true, medsConfirmed: true, followUp: "2w", language: "ms" } } }).where(eq(encounters.id, "visit-1042"));
  const doctor = createRouterClient(appRouter, { context: { db, session: user("dr-aisyah"), now: () => now } });
  await doctor.discharge.request({ encounterId: "visit-1042", requestId: "req-d1", approvedBy: "dr-aisyah" });
  const heard: [string, Change][] = [];
  const models: Models = { ...stubModels, classifyReply: async () => ({ label, ...label === "fine" ? {} : { symptom: "fever returned" }, source: "model" as const, model: "gemma-test" }) };
  const context: Context = { db, session: null, models, now: () => now, announce: async (hospitalId, change) => { heard.push([hospitalId, change]); } };
  return { db, doctor, context, heard };
}

test("a patient telling Sona they feel worse flags one task for the attending doctor and Sona Pro hears it; no check-in is sent or answered by it", async () => {
  const { db, doctor, context, heard } = await world("worse");
  const told = await tellCareTeam(context, DEMO_HOSPITAL, "SYN-1042", "Demam saya datang balik malam tadi");
  expect(told?.title).toBe("Amelia: fever returned after discharge");
  expect(heard).toEqual([[DEMO_HOSPITAL, { topic: "checkIns", patientId: "SYN-1042" }]]);
  const [task] = await db.select().from(tasks).where(eq(tasks.id, told!.taskId));
  expect([task!.kind, task!.owner, task!.due, task!.completed, task!.encounterId]).toEqual(["check-in", "Attending doctor", "Today", false, "visit-1042"]);
  // The same problem said again rides on the open task: the doctor sees one item.
  expect(await tellCareTeam(context, DEMO_HOSPITAL, "SYN-1042", "Masih demam")).toEqual(told);
  expect(await db.select().from(tasks).where(eq(tasks.kind, "check-in"))).toHaveLength(1);
  // Her scheduled check-ins are untouched (day 2 is not due yet), and still hers to answer.
  expect((await doctor.checkIns.list({ encounterId: "visit-1042" })).map(c => [c.day, c.sentAt, c.replies.length])).toEqual([[2, null, 0], [7, null, 0]]);
  const answered = await doctor.checkIns.reply({ checkInId: "check-in:visit-1042:2", text: "Demam balik" });
  expect(answered.replies.map(r => [r.label, r.task?.id])).toEqual([["worse", told!.taskId]]);
  // Booked in like any flagged reply.
  expect((await doctor.checkIns.bookIn({ taskId: told!.taskId })).kind).toBe("Clinic review · fever returned");
});

test("words read as fine flag nothing; a patient still in hospital, with no check-ins, is passed on too", async () => {
  const fine = await world("fine");
  expect(await tellCareTeam(fine.context, DEMO_HOSPITAL, "SYN-1042", "Saya rasa lebih baik hari ini")).toBeUndefined();
  expect(await fine.db.select().from(tasks).where(eq(tasks.kind, "check-in"))).toEqual([]);
  expect(fine.heard).toEqual([]);
  const inHospital = await world("urgent");
  const told = await tellCareTeam(inHospital.context, DEMO_HOSPITAL, "SYN-1086", "Sakit dada");
  // Not "after discharge": he has not left.
  expect(told?.title).toBe("Daniel: fever returned");
  expect((await inHospital.doctor.tasks.list()).filter(t => t.kind === "check-in").map(t => [t.id, t.title, t.owner, t.due, t.encounterId, t.completed]))
    .toEqual([[told!.taskId, "Daniel: fever returned", "Attending doctor", "Today", "visit-1086", false]]);
  expect(inHospital.heard).toEqual([[DEMO_HOSPITAL, { topic: "checkIns", patientId: "SYN-1086" }]]);
  expect(await tellCareTeam(inHospital.context, DEMO_HOSPITAL, "SYN-0000", "Sakit dada")).toBeUndefined();
});
