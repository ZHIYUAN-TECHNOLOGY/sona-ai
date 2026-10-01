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

test("a patient telling Sona they feel worse flags a task for the attending doctor, the way a check-in reply does, and Sona Pro hears it", async () => {
  const { db, doctor, context, heard } = await world("worse");
  const told = await tellCareTeam(context, DEMO_HOSPITAL, "SYN-1042", "Demam saya datang balik malam tadi");
  expect(told?.title).toBe("Amelia: fever returned after discharge");
  expect(heard).toEqual([[DEMO_HOSPITAL, { topic: "checkIns", patientId: "SYN-1042" }]]);
  const [task] = await db.select().from(tasks).where(eq(tasks.id, told!.taskId));
  expect([task!.kind, task!.owner, task!.due, task!.completed]).toEqual(["check-in", "Attending doctor", "Today", false]);
  // On the doctor's side it is a reply to the day-2 check-in (sent now), with its flag, so My Day shows it with Book in.
  const [day2] = await doctor.checkIns.list({ encounterId: "visit-1042" });
  expect([day2!.day, Boolean(day2!.sentAt), day2!.replies.map(r => [r.text, r.label, r.task?.id])]).toEqual([2, true, [["Demam saya datang balik malam tadi", "worse", told!.taskId]]]);
});

test("a reply read as fine flags nothing; a patient with no check-ins (still in hospital) is not passed on", async () => {
  const fine = await world("fine");
  expect(await tellCareTeam(fine.context, DEMO_HOSPITAL, "SYN-1042", "Saya rasa lebih baik hari ini")).toBeUndefined();
  expect(await fine.db.select().from(tasks).where(eq(tasks.kind, "check-in"))).toEqual([]);
  const inHospital = await world("urgent");
  expect(await tellCareTeam(inHospital.context, DEMO_HOSPITAL, "SYN-1086", "Sakit dada")).toBeUndefined();
  expect(inHospital.heard).toEqual([]);
});
