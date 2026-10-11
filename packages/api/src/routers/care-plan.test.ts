import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { appointments, encounters, guaranteeLetters, patients, provenance } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { patientsFor } from "../audience";
import type { Change } from "../events";
import { stubModels, type Models } from "../models";
import { planText, recordText } from "./care-plan";
import { scheduleCheckIns } from "./check-ins";
import { appRouter } from "./index";

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

/** Amelia joined Sona Care on a fixed clock; discharges are written straight to the visit state so their time is fixed too. */
async function world(models?: Models) {
  const db = await createTestDb();
  const clock = { now: new Date("2026-09-26T10:00:00+08:00") };
  await seedDemo(db, clock.now);
  await addClinician(db, "dr-aisyah");
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), now: () => clock.now, models } });
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

test("a discharge is announced with its visit, which is how Amelia's own Sona Care hears it and re-reads her plan", async () => {
  const { db, clock } = await world();
  const heard: Change[] = [];
  const doctor = createRouterClient(appRouter, { context: { db, session: user("dr-aisyah"), now: () => clock.now, announce: async (_: string, change: Change) => { heard.push(change); } } });
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: clock.now }).where(eq(guaranteeLetters.id, "gl-1042"));
  await db.update(encounters).set({ state: { discharge: { glReceived: true, medsConfirmed: true, followUp: "2w", language: "en" } } }).where(eq(encounters.id, "visit-1042"));
  await doctor.discharge.request({ encounterId: "visit-1042", requestId: "req-d1", approvedBy: "dr-aisyah" });
  expect(heard).toEqual([{ topic: "discharge", encounterId: "visit-1042" }]);
  // The Worker tells the patient of that visit (announcer, apps/server/src/context.ts); her plan is there to read by then.
  expect(await patientsFor(db, "demo", heard[0]!)).toEqual(["SYN-1042"]);
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

test("Amelia reads the leaflet her doctor approved at discharge, in its language, and Sona Care answers from it; a later draft changes nothing", async () => {
  let n = 0;
  const grounded: string[] = [];
  const models: Models = {
    ...stubModels,
    draftDischarge: async ({ language }) => ({ summary: "Drafted summary", leaflet: `Draf ${++n} (${language})`, source: "model", model: "fake-gemma" }),
    answerFromPlan: async input => { grounded.push(input.plan); return { answer: "", grounded: false, urgent: false, source: "fixture" }; },
  };
  const { db, clock, doctor, amelia } = await world(models);
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: clock.now }).where(eq(guaranteeLetters.id, "gl-1042"));
  await db.update(encounters).set({ state: { discharge: { glReceived: true, medsConfirmed: true, followUp: "2w", language: "ms" } } }).where(eq(encounters.id, "visit-1042"));
  await doctor.discharge.draft({ encounterId: "visit-1042", language: "en" }); // Draf 1: not the discharge language
  await doctor.discharge.draft({ encounterId: "visit-1042", language: "ms" }); // Draf 2: what she approves
  await doctor.discharge.request({ encounterId: "visit-1042", requestId: "req-d1", approvedBy: "dr-aisyah" });
  // Opened again, the same record gets the model's stored draft; once her record changes, the model drafts again.
  expect(await doctor.discharge.draft({ encounterId: "visit-1042", language: "ms" })).toMatchObject({ leaflet: "Draf 2 (ms)", source: "model", model: "fake-gemma" });
  await db.update(patients).set({ allergies: "Penicillin; sulfonamides" }).where(eq(patients.id, "SYN-1042"));
  await doctor.discharge.draft({ encounterId: "visit-1042", language: "ms" }); // Draf 3: after discharge

  const plan = await amelia.care.discharge();
  if (plan.status !== "discharged") throw new Error("expected a discharged plan");
  expect(plan.leaflets.map(l => [l.language, l.text.slice(0, 11)])).toEqual([["ms", "Draf 2 (ms)"], ["en", "You were tr"], ["zh", "您因肺部感染接受了治疗"]]);
  // The one that went home is a model's draft a doctor approved, and says so; the others are the authored ones.
  expect(plan.leaflets[0]).toMatchObject({ source: "model", model: "fake-gemma", approvedBy: "Dr dr-aisyah", approvedAt: clock.now.toISOString() });
  expect(plan.leaflets.slice(1).map(l => [l.source, "approvedBy" in l])).toEqual([["fixture", false], ["fixture", false]]);
  // A discharge from before the drafter was kept has the words only: unknown, never a model's.
  await db.update(encounters).set({ state: sql`jsonb_set(${encounters.state}, '{discharge,leaflet}', '{"language":"ms","text":"Lama"}')` }).where(eq(encounters.id, "visit-1042"));
  const old = await amelia.care.discharge();
  expect(old.status === "discharged" && old.leaflets[0]).toMatchObject({ text: "Lama", source: "unknown" });
  await db.update(encounters).set({ state: sql`jsonb_set(${encounters.state}, '{discharge,leaflet,text}', '"Draf 2 (ms)"')` }).where(eq(encounters.id, "visit-1042"));
  // The approved draft carries its approver in the provenance trail; the others stay unapproved.
  const drafts = await db.select({ output: provenance.output, approvedBy: provenance.approvedBy }).from(provenance).where(eq(provenance.kind, "discharge-draft"));
  expect(drafts.map(d => [(d.output as { leaflet: string }).leaflet, d.approvedBy]).sort()).toEqual([["Draf 1 (en)", null], ["Draf 2 (ms)", "dr-aisyah"], ["Draf 3 (ms)", null]]);
  await amelia.care.ask({ question: "Apa kata risalah saya?" });
  expect(grounded[0]).toContain("Draf 2 (ms)");
  // Home, her visits still follow her plan.
  expect(grounded[0]).toContain("- Clinic visit: Sat, 26 Sep 2026 10:15 (coming up)");
});

test("still in hospital, Sona Care's model reads the visits her app shows: the booked one, the one she asked for, and the time now", async () => {
  const read: string[] = [];
  const { clock, amelia } = await world({ ...stubModels, answerFromPlan: async input => { read.push(input.plan); return { answer: "", grounded: false, urgent: false, source: "fixture" }; } });
  const [doctor] = await amelia.care.doctors.list();
  const startsAt = doctor!.nextSlots[0]!.times[0]!;
  await amelia.care.bookings.request({ doctorId: doctor!.id, startsAt });
  await amelia.care.ask({ question: "When is my next visit?" });
  expect(read[0]).toStartWith("Still in hospital");
  expect(read[0]).toContain("Now: Sat, 26 Sep 2026 10:00 (Malaysia time)");
  expect(read[0]).toContain("- Clinic visit: Sat, 26 Sep 2026 10:15 (coming up)");
  expect(read[0]).toContain(`waiting for the care team to confirm:\n- ${doctor!.name} (${doctor!.specialty}): ${new Date(startsAt.getTime() + 8 * 3600_000).toUTCString().slice(0, 22)}`);
  // Once its time has gone by it is no longer the one coming up.
  clock.now = new Date("2026-09-26T10:30:00+08:00");
  await amelia.care.ask({ question: "When is my next visit?" });
  expect(read[1]).toContain("- Clinic visit: Sat, 26 Sep 2026 10:15 (earlier today)");
});

test("azithromycin reads as current until its last dose has gone by on the demo clock, then finished, in Care and in what the models read", async () => {
  const { clock, amelia, discharge } = await world();
  await discharge("visit-1042", { followUp: "2w", language: "en", dischargedAt: "2026-09-26T07:40:00.000Z" }); // Sat 15:40: doses Sun and Mon at 08:00
  const read = async (lang?: "ms") => {
    const plan = await amelia.care.discharge(lang && { lang });
    if (plan.status !== "discharged") throw new Error("expected a discharged plan");
    return plan;
  };
  clock.now = new Date("2026-09-28T13:59:00+08:00"); // Monday's dose can still be logged
  const during = await read();
  expect(during.medicines.changed[0]).toMatchObject({ line: "Now a tablet once a day, for 2 more days", endsAt: new Date("2026-09-28T08:00:00+08:00") });
  expect(planText(during, clock.now)).toContain("- Azithromycin (changed): Now a tablet once a day, for 2 more days; 1 tablet, with or without food; at 08:00; last dose Mon, 28 Sep 2026\n");
  clock.now = new Date("2026-09-28T14:00:00+08:00");
  const after = await read();
  expect(after.medicines.changed[0]).toMatchObject({ finished: true, line: "Course finished, nothing left to take" });
  expect(planText(after, clock.now)).toContain("- Azithromycin (changed): Course finished, nothing left to take; last dose Mon, 28 Sep 2026\n");
  expect(planText(after, clock.now)).toContain("- Cetirizine (continue): Keep taking it as before; 1 tablet at night; at 21:00\n");
  // One she still takes with no times says so, so a next dose is not made up; a stopped one says nothing of times.
  expect(planText(after, clock.now)).toContain("- Paracetamol (new): For pain or fever: 1 g every 6 hours if you need it, no more than 4 g a day; no set times\n");
  expect(planText(after, clock.now)).toContain("- Salbutamol nebuliser (stopped): Use your own inhaler instead, when you need it\n");
  expect((await read("ms")).medicines.changed[0]!.line).toBe("Kursus sudah tamat, tiada lagi untuk diambil");
});

test("her record says she is home and for how long; only one still in hospital reads that the ward nurse brings each dose", async () => {
  const { db, clock, discharge } = await world();
  const record = async () => (await recordText({ db, session: null, now: () => clock.now, hospitalId: "demo", patientId: "SYN-1042" })).text;
  expect(await record()).toStartWith("Still in hospital: the ward nurse brings each dose;");
  await discharge("visit-1042", { followUp: "2w", language: "en", dischargedAt: "2026-09-26T00:00:00.000Z" }); // 08:00 in Malaysia
  expect(await record()).toStartWith("At home since Sat, 26 Sep 2026 08:00 (today)\n");
  clock.now = new Date("2026-09-28T07:00:00+08:00"); // two Malaysian days on, though not 48 hours
  const home = await record();
  expect(home).toStartWith("At home since Sat, 26 Sep 2026 08:00 (2 days)\n");
  expect(home).not.toContain("ward nurse");
});

test("the plan's check-ins are the visit's own, including one the check-in agent brought forward", async () => {
  const { db, clock, amelia, discharge } = await world();
  const out = "2026-09-26T07:40:00.000Z", amy = { id: "SYN-1042", name: "Amelia Tan" };
  await discharge("visit-1042", { followUp: "2w", language: "en", dischargedAt: out, checkInDays: [2, 7, 14] });
  await scheduleCheckIns(db, "demo", amy, "visit-1042", "en", new Date(out), [2, 7, 14]);
  await scheduleCheckIns(db, "demo", amy, "visit-1042", "en", new Date(out), [4]); // brought forward after a worse reply
  const plan = await amelia.care.discharge();
  if (plan.status !== "discharged") throw new Error("expected a discharged plan");
  expect(plan.checkIns.map(c => c.day)).toEqual([2, 4, 7, 14]);
  expect(plan.checkIns[1]!.date).toEqual(new Date("2026-09-30T10:00:00+08:00"));
  expect(planText(plan, clock.now)).toContain("Check-ins: day 2, day 4, day 7 and day 14 after discharge (Mon, 28 Sep 2026; Wed, 30 Sep 2026; Sat, 03 Oct 2026; Sat, 10 Oct 2026)");
});

test("the plan and follow-ups come in the language Sona Care asks for, English per string where a word is missing", async () => {
  const { amelia, discharge } = await world();
  await discharge("visit-1042", { followUp: "2w", language: "ms", dischargedAt: "2026-09-26T07:40:00.000Z" });
  const plan = await amelia.care.discharge({ lang: "zh" });
  if (plan.status !== "discharged") throw new Error("expected a discharged plan");
  expect(plan.followUp?.title).toBe("门诊复诊");
  expect(plan.warningSigns).toContain("嘴唇或指尖发紫");
  expect(plan.medicines.changed[0]).toMatchObject({ name: "Azithromycin", line: "现在改为每天一片，再服两天", take: "每次一片，饭前饭后都可以" });
  expect((await amelia.care.followUps({ lang: "ms" })).map(f => [f.title, f.why])).toEqual([
    ["Lawatan klinik", "Temu janji yang telah ditempah"], ["Semakan klinik", "Untuk melihat keadaan anda selepas radang paru-paru"],
  ]);
  // No input keeps the English words existing callers read.
  expect((await amelia.care.followUps()).map(f => f.title)).toEqual(["Clinic visit", "Clinic review"]);
});

test("a visit a doctor saw the patient on reads attended the next day; one nobody saw reads missed, never before its day ends", async () => {
  const { db, clock, amelia, as, discharge } = await world();
  await addClinician(db, "nurse-mei", undefined, "nurse");
  await discharge("visit-1042", { followUp: "2w", language: "en", dischargedAt: "2026-09-26T07:40:00.000Z" });
  const status = async () => Object.fromEntries((await amelia.care.followUps()).map(f => [f.short, f.status]));
  const at = (iso: string) => { clock.now = new Date(iso); };
  at("2026-10-10T09:00:00+08:00"); // the review day: a nurse opens her visit, which is not the review
  await as("nurse-mei").encounter.get({ encounterId: "visit-1042" });
  at("2026-10-10T23:30:00+08:00");
  expect(await status()).toEqual({ "Clinic review": "due-soon" });
  at("2026-10-11T08:00:00+08:00"); // the day has ended; the clinic visit on her discharge day, before she left, is gone
  expect(await status()).toEqual({ "Clinic review": "missed" });
  at("2026-10-10T10:00:00+08:00"); // the doctor sees her on the day
  await as("dr-aisyah").encounter.get({ encounterId: "visit-1042" });
  expect(await status()).toEqual({ "Clinic review": "due-soon" });
  at("2026-10-11T08:00:00+08:00");
  expect(await status()).toEqual({ "Clinic review": "attended" });
});

test("follow-ups list Amelia's own, earliest first, once each, and turn due soon then missed as the days pass", async () => {
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
  clock.now = new Date("2026-10-05T09:00:00+08:00"); // the clinic visit was before she went home, so it is gone
  expect((await view()).map(f => [f[0], f[4], f[5]])).toEqual([["Clinic review", 5, "due-soon"], ["CT scan", 81, "upcoming"]]);
  clock.now = new Date("2026-12-26T09:00:00+08:00"); // no doctor opened her visit on either day
  expect((await view()).map(f => [f[0], f[4], f[5]])).toEqual([["Clinic review", -77, "missed"], ["CT scan", -1, "missed"]]);
});

test("a clinician or an unlinked account cannot read a patient's plan", async () => {
  const { doctor, as } = await world();
  expect((await doctor.care.discharge().catch(e => e)).code).toBe("FORBIDDEN");
  expect((await as("stranger").care.followUps().catch(e => e)).code).toBe("FORBIDDEN");
});
