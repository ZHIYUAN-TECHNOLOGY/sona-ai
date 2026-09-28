import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { appointments, encounters } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { appRouter } from "./index";

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

/** Amelia joined Sona Care on a fixed clock; discharges are written straight to the visit state so their time is fixed too. */
async function world() {
  const db = await createTestDb();
  const clock = { now: new Date("2026-09-26T10:00:00+08:00") };
  await seedDemo(db, clock.now);
  await addClinician(db, "dr-aisyah");
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), now: () => clock.now } });
  const doctor = as("dr-aisyah"), amelia = as("amelia-account");
  await amelia.care.join({ code: (await doctor.care.code({ encounterId: "visit-1042" })).code });
  const discharge = (encounterId: string, state: object) => db.update(encounters).set({ state: { discharge: { glReceived: true, medsConfirmed: true, ...state } } }).where(eq(encounters.id, encounterId));
  return { db, clock, doctor, amelia, as, discharge };
}

test("before discharge Amelia's plan says she is still in hospital, even when another patient has gone home", async () => {
  const { amelia, discharge } = await world();
  await discharge("visit-1086", { followUp: "1w", language: "en", dischargedAt: "2026-09-25T08:00:00.000Z" });
  expect(await amelia.care.discharge()).toEqual({ status: "in-hospital" });
});

test("after discharge Amelia reads her plan in plain words, the leaflet first in the language chosen at discharge", async () => {
  const { amelia, discharge } = await world();
  await discharge("visit-1042", { followUp: "2w", language: "zh", dischargedAt: "2026-09-26T07:40:00.000Z" }); // 15:40 in Malaysia
  const plan = await amelia.care.discharge();
  if (plan.status !== "discharged") throw new Error("expected a discharged plan");
  expect(plan.dischargedAt).toBe("2026-09-26T07:40:00.000Z");
  expect(plan.language).toBe("zh");
  expect(plan.leaflets.map(l => [l.language, l.name])).toEqual([["zh", "Chinese"], ["ms", "Bahasa Melayu"], ["en", "English"]]);
  expect(plan.leaflets[0]!.text).toStartWith("您因肺部感染接受了治疗");
  expect(Object.fromEntries(Object.entries(plan.medicines).map(([group, meds]) => [group, meds.map(m => m.name)]))).toEqual({
    new: ["Paracetamol"], changed: ["Azithromycin"], stopped: ["Salbutamol nebuliser"], continue: ["Cetirizine"],
  });
  expect(plan.medicines.changed[0]!.line).toBe("Now a tablet once a day, for 2 more days");
  expect(plan.warningSigns).toContain("Your lips or fingertips turn blue");
  // Two weeks on from 26 Sep, and the check-ins on day 2 and day 7 at 10:00 Malaysian time.
  expect(plan.followUp).toEqual({ title: "Clinic review", date: new Date("2026-10-10T07:40:00.000Z") });
  expect(plan.checkIns).toEqual([{ day: 2, date: new Date("2026-09-28T10:00:00+08:00") }, { day: 7, date: new Date("2026-10-03T10:00:00+08:00") }]);
});

test("follow-ups list Amelia's own, earliest first, once each, and turn due soon then overdue as the days pass", async () => {
  const { db, clock, doctor, amelia, discharge } = await world();
  await discharge("visit-1042", { followUp: "2w", language: "ms", dischargedAt: "2026-09-26T07:40:00.000Z" });
  const [nodule] = await doctor.findings.detect({ encounterId: "visit-1042" }); // the heart-size finding stays open, so it is not the patient's yet
  await doctor.findings.track({ findingId: nodule!.id, requestId: "track-1" });
  const view = async () => (await amelia.care.followUps()).map(f => [f.short, f.title, f.why, f.date.toISOString(), f.inDays, f.status]);
  expect(await view()).toEqual([
    ["Clinic visit", "Clinic visit", "Your booked appointment", "2026-09-26T02:15:00.000Z", 0, "due-soon"],
    ["Clinic review", "Clinic review", "To see how you're doing after your pneumonia", "2026-10-10T07:40:00.000Z", 14, "upcoming"],
    ["CT scan", "CT scan of your chest", "To check the small spot on your lung X-ray", "2026-12-25T02:00:00.000Z", 90, "upcoming"],
  ]);
  // A tracked finding whose recall is missing still shows, from its due date.
  await db.delete(appointments).where(eq(appointments.id, `recall:${nodule!.id}`));
  expect((await view()).map(f => f[0])).toEqual(["Clinic visit", "Clinic review", "CT scan"]);
  clock.now = new Date("2026-10-05T09:00:00+08:00"); // the clinic visit has happened
  expect((await view()).map(f => [f[0], f[4], f[5]])).toEqual([["Clinic review", 5, "due-soon"], ["CT scan", 81, "upcoming"]]);
  clock.now = new Date("2026-12-26T09:00:00+08:00");
  expect((await view()).map(f => [f[0], f[4], f[5]])).toEqual([["Clinic review", -77, "overdue"], ["CT scan", -1, "overdue"]]);
});

test("a clinician or an unlinked account cannot read a patient's plan", async () => {
  const { doctor, as } = await world();
  expect((await doctor.care.discharge().catch(e => e)).code).toBe("FORBIDDEN");
  expect((await as("stranger").care.followUps().catch(e => e)).code).toBe("FORBIDDEN");
});
