import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { careLinks, hospitalMembers, hospitals } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";

import type { Change } from "../events";
import { scheduleCheckIns } from "./check-ins";
import { hospitalOf } from "./hospital";
import { appRouter } from "./index";

const user = (id: string, name = id) => ({
  user: { id, name, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

/** A clinician (the test doctor) and a Sona Care account for Amelia, sharing one database and clock. */
async function world() {
  const db = await createTestDb();
  const clock = { now: new Date("2026-09-26T10:00:00+08:00") };
  await seedDemo(db, clock.now);
  const heard: [string, Change][] = [];
  const as = (session: Session | null) => createRouterClient(appRouter, { context: { db, session, now: () => clock.now, announce: async (h: string, c: Change) => { heard.push([h, c]); } } });
  return { db, clock, heard, doctor: as(user("dr-aisyah")), amelia: as(user("amelia-account", "Amelia Tan")), anyone: as(null), as };
}

test("the doctor issues Amelia's code once per visit; anyone can preview it, and it shows only her first name and the hospital", async () => {
  const { doctor, anyone } = await world();
  const issued = await doctor.care.code({ encounterId: "visit-1042" });
  expect(issued.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  expect(await doctor.care.code({ encounterId: "visit-1042" })).toEqual(issued);
  expect(issued.link).toBe(`sona-care://join?code=${issued.code}`);
  expect(await anyone.care.preview({ code: issued.code.toLowerCase().replace("-", "") })).toEqual({ firstName: "Amelia", hospital: "Demo General Hospital (synthetic)" });
  expect((await anyone.care.preview({ code: "ZZZZ-ZZZZ" }).catch(e => e)).code).toBe("NOT_FOUND");
});

test("redeeming links the account to Amelia only: it reads her own record, and never opens a clinical route", async () => {
  const { doctor, amelia, db } = await world();
  const { code } = await doctor.care.code({ encounterId: "visit-1042" });
  expect(await amelia.care.join({ code })).toEqual({ firstName: "Amelia" });
  expect(await amelia.care.join({ code })).toEqual({ firstName: "Amelia" }); // a replay by the same account changes nothing
  expect(await amelia.care.me()).toMatchObject({ patientId: "SYN-1042", name: "Amelia Tan", firstName: "Amelia", encounterId: "visit-1042", hospital: "Demo General Hospital (synthetic)", dischargedAt: undefined });
  for (const call of [() => amelia.tasks.list(), () => amelia.results.list(), () => amelia.ward.beds(), () => amelia.encounter.get({ encounterId: "visit-1086" })])
    expect((await call().catch(e => e)).code).toBe("FORBIDDEN");
  // The Sona Care account never joined a hospital as a clinician.
  expect(await db.select().from(hospitalMembers)).toHaveLength(1);
  expect((await db.select().from(careLinks))[0]).toMatchObject({ userId: "amelia-account", patientId: "SYN-1042" });
});

test("a code redeems once; an expired code, a clinician account and a signed-out caller cannot join", async () => {
  const { doctor, amelia, clock, as } = await world();
  const { code } = await doctor.care.code({ encounterId: "visit-1042" });
  await amelia.care.join({ code });
  expect((await as(user("someone-else")).care.join({ code }).catch(e => e)).code).toBe("CONFLICT");
  expect((await doctor.care.join({ code }).catch(e => e)).code).toBe("FORBIDDEN");
  const other = await doctor.care.code({ encounterId: "visit-1086" });
  clock.now = new Date(clock.now.getTime() + 15 * 24 * 3600_000);
  expect((await as(user("late")).care.join({ code: other.code }).catch(e => e)).code).toBe("PRECONDITION_FAILED");
  expect((await as(null).care.join({ code: other.code }).catch(e => e)).code).toBe("UNAUTHORIZED");
});

test("an account that is not linked cannot use Sona Care routes", async () => {
  const { doctor, as } = await world();
  expect((await doctor.care.me().catch(e => e)).code).toBe("FORBIDDEN");
  expect((await as(user("new-person")).care.me().catch(e => e)).code).toBe("FORBIDDEN");
});

test("a Sona Care account is never made a clinician, whichever door it tries (the API, or the live-updates socket's hospital lookup)", async () => {
  const { doctor, amelia, db } = await world();
  const { code } = await doctor.care.code({ encounterId: "visit-1042" });
  await amelia.care.join({ code });
  expect((await hospitalOf(db, "amelia-account").catch(e => e)).code).toBe("FORBIDDEN");
  expect(await db.select().from(hospitalMembers)).toHaveLength(1);
});

/** Amelia joined Sona Care; both demo patients have their day 2 and day 7 check-ins scheduled (Amelia's in Malay). */
async function joined() {
  const w = await world();
  const { code } = await w.doctor.care.code({ encounterId: "visit-1042" });
  await w.amelia.care.join({ code });
  await scheduleCheckIns(w.db, "demo", { id: "SYN-1042", name: "Amelia Tan" }, "visit-1042", "ms", w.clock.now);
  await scheduleCheckIns(w.db, "demo", { id: "SYN-1086", name: "Farid Hassan" }, "visit-1086", "en", w.clock.now);
  w.heard.length = 0;
  return w;
}

test("Amelia sees only her own check-ins, in her language, with nothing answered yet", async () => {
  const { amelia } = await joined();
  const list = await amelia.care.checkIns.list();
  expect(list.map(c => [c.id, c.day, c.language, c.sentAt, c.replies])).toEqual([["check-in:visit-1042:2", 2, "ms", null, []], ["check-in:visit-1042:7", 7, "ms", null, []]]);
});

test("Amelia's \"demam balik\" two days later sends her check-in and flags one task for the attending doctor; a fine reply is only logged", async () => {
  const { amelia, doctor, clock, heard } = await joined();
  clock.now = new Date("2026-09-28T10:02:00+08:00");
  const day2 = await amelia.care.checkIns.reply({ checkInId: "check-in:visit-1042:2", text: "demam balik" });
  expect(day2.sentAt?.toISOString()).toBe(clock.now.toISOString());
  expect(day2.replies).toMatchObject([{ text: "demam balik", label: "worse", task: { title: "Amelia: fever returned after discharge", completed: false } }]);
  expect((await doctor.tasks.list()).filter(t => t.kind === "check-in").map(t => [t.title, t.owner, t.encounterId])).toEqual([["Amelia: fever returned after discharge", "Attending doctor", "visit-1042"]]);
  // The doctor's app re-reads check-ins and My Day.
  expect(heard).toEqual([["demo", { topic: "checkIns" }]]);

  const day7 = await amelia.care.checkIns.reply({ checkInId: "check-in:visit-1042:7", text: "Sudah sihat, terima kasih" });
  expect(day7.replies).toMatchObject([{ label: "fine", task: null }]);
  expect((await doctor.tasks.list()).filter(t => t.kind === "check-in")).toHaveLength(1);
  expect((await amelia.care.checkIns.list()).map(c => c.replies.map(r => r.label))).toEqual([["worse"], ["fine"]]);
});

test("Amelia cannot answer another patient's check-in; check-ins need a signed-in, linked Sona Care account", async () => {
  const { amelia, doctor, as } = await joined();
  expect((await amelia.care.checkIns.reply({ checkInId: "check-in:visit-1086:2", text: "demam balik" }).catch(e => e)).code).toBe("NOT_FOUND");
  expect((await doctor.checkIns.list({ encounterId: "visit-1086" }))[0]?.replies).toEqual([]);
  const codes = async (caller: ReturnType<typeof as>) => [
    (await caller.care.checkIns.list().catch(e => e)).code, (await caller.care.checkIns.reply({ checkInId: "check-in:visit-1042:2", text: "ok" }).catch(e => e)).code];
  expect(await codes(as(null))).toEqual(["UNAUTHORIZED", "UNAUTHORIZED"]);
  expect(await codes(as(user("new-person")))).toEqual(["FORBIDDEN", "FORBIDDEN"]);
  expect(await codes(doctor)).toEqual(["FORBIDDEN", "FORBIDDEN"]);
});

test("Amelia's message reaches her care team as one task for the attending doctor, once however often it is resent", async () => {
  const { amelia, doctor, heard } = await joined();
  const text = "Can I take paracetamol with the antibiotics you gave me? The leaflet does not say.";
  const sent = await amelia.care.messages.send({ text, requestId: "req-m1" });
  expect(await amelia.care.messages.send({ text, requestId: "req-m1" })).toEqual(sent);
  expect((await amelia.care.messages.list()).map(m => [m.from, m.text])).toEqual([["patient", text]]);
  expect((await doctor.tasks.list()).filter(t => t.kind === "message").map(t => [t.title, t.owner, t.due, t.encounterId, t.completed]))
    .toEqual([["Amelia: Can I take paracetamol with the antibiotics you gave me? The…", "Attending doctor", "Today", "visit-1042", false]]);
  expect(heard).toContainEqual(["demo", { topic: "messages" }]);
});

test("the doctor reads Amelia's thread and answers once; the answer closes her message task, and only her own thread is hers", async () => {
  const { amelia, doctor, clock, as, db } = await joined();
  await amelia.care.messages.send({ text: "Is a little cough normal?", requestId: "req-m1" });
  clock.now = new Date(clock.now.getTime() + 60_000);
  expect((await doctor.messages.list({ patientId: "SYN-1042" })).map(m => [m.from, m.text])).toEqual([["patient", "Is a little cough normal?"]]);
  const answer = { patientId: "SYN-1042", text: "Yes, for a week or two. Tell us if you get a fever.", requestId: "req-r1" };
  expect(await doctor.messages.reply(answer)).toEqual(await doctor.messages.reply(answer));
  expect((await amelia.care.messages.list()).map(m => [m.from, m.text])).toEqual([["patient", "Is a little cough normal?"], ["care-team", answer.text]]);
  expect((await doctor.tasks.list()).filter(t => t.kind === "message").map(t => t.completed)).toEqual([true]);

  // Another patient's thread is empty to Amelia; another hospital's doctor cannot open hers.
  expect((await as(null).care.messages.send({ text: "hi", requestId: "x" }).catch(e => e)).code).toBe("UNAUTHORIZED");
  expect((await doctor.care.messages.list().catch(e => e)).code).toBe("FORBIDDEN");
  await db.insert(hospitals).values({ id: "other", name: "Other Hospital (synthetic)" });
  await db.insert(hospitalMembers).values({ userId: "dr-other", hospitalId: "other" });
  expect((await as(user("dr-other")).messages.list({ patientId: "SYN-1042" }).catch(e => e)).code).toBe("NOT_FOUND");
  expect((await as(user("dr-other")).messages.reply({ ...answer, requestId: "req-r2" }).catch(e => e)).code).toBe("NOT_FOUND");
  expect(await doctor.messages.list({ patientId: "SYN-1086" })).toEqual([]);
});
