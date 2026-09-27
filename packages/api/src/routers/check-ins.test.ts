import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { encounters, guaranteeLetters, hospitalMembers, hospitals } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { sendDueCheckIns } from "./check-ins";
import { appRouter } from "./index";

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

/** Amelia discharged with every blocker cleared and her leaflet in `language`; the clock can then jump days. */
async function discharged(language = "ms") {
  const clock = { now: new Date("2026-09-26T15:40:00+08:00") };
  const db = await createTestDb();
  await seedDemo(db, clock.now);
  await addClinician(db, "dr-aisyah");
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: clock.now }).where(eq(guaranteeLetters.id, "gl-1042"));
  await db.update(encounters).set({ state: { discharge: { glReceived: true, medsConfirmed: true, followUp: "2w", language } } }).where(eq(encounters.id, "visit-1042"));
  const as = (id: string | null) => createRouterClient(appRouter, { context: { db, session: id ? user(id) : null, now: () => clock.now } });
  const api = as("dr-aisyah");
  await api.discharge.request({ encounterId: "visit-1042", requestId: "req-d1", approvedBy: "dr-aisyah" });
  return { db, clock, api, as };
}

test("a discharge schedules the day 2 and day 7 check-ins at 10:00 in the leaflet's language, once", async () => {
  const { api } = await discharged("ms");
  await api.discharge.request({ encounterId: "visit-1042", requestId: "req-d2", approvedBy: "dr-aisyah" }); // a second approval changes nothing
  const list = await api.checkIns.list({ encounterId: "visit-1042" });
  expect(list.map(c => [c.day, c.language, c.patientId, c.sentAt, c.replies])).toEqual([[2, "ms", "SYN-1042", null, []], [7, "ms", "SYN-1042", null, []]]);
  expect(list.every(c => c.dueAt.getUTCHours() === 2 && c.message.startsWith("Hai Amelia,"))).toBe(true);
  expect(await api.checkIns.list({ encounterId: "visit-1086" })).toEqual([]);
});

test("the hourly send marks only due check-ins sent, once, for its own hospital; tick sends now from the app", async () => {
  const { db, clock, api } = await discharged();
  expect(await sendDueCheckIns(db, "demo", clock.now)).toEqual({ sent: 0 });
  expect(await sendDueCheckIns(db, "other", new Date("2026-10-10T00:00:00Z"))).toEqual({ sent: 0 });
  const monday = new Date("2026-09-28T10:00:00+08:00");
  expect(await sendDueCheckIns(db, "demo", monday)).toEqual({ sent: 1 });
  expect(await sendDueCheckIns(db, "demo", new Date("2026-09-28T11:00:00+08:00"))).toEqual({ sent: 0 });
  clock.now = new Date("2026-10-03T10:30:00+08:00");
  expect(await api.checkIns.tick()).toEqual({ sent: 1 });
  expect((await api.checkIns.list()).map(c => [c.day, c.sentAt?.toISOString()])).toEqual([[2, monday.toISOString()], [7, clock.now.toISOString()]]);
});

test("\"demam balik\" two days later sends the check-in and flags one task for the attending doctor; a fine reply is only logged", async () => {
  const { clock, api } = await discharged();
  clock.now = new Date("2026-09-28T10:02:00+08:00");
  const day2 = await api.checkIns.reply({ checkInId: "check-in:visit-1042:2", text: "demam balik" });
  expect(day2.sentAt?.toISOString()).toBe(clock.now.toISOString());
  expect(day2.replies).toMatchObject([{ text: "demam balik", label: "worse", source: "fixture", task: { title: "Amelia: fever returned after discharge", completed: false } }]);
  const flagged = (await api.tasks.list()).filter(t => t.kind === "check-in");
  expect(flagged.map(t => [t.id, t.title, t.owner, t.due, t.encounterId])).toEqual([[day2.replies[0]!.task!.id, "Amelia: fever returned after discharge", "Attending doctor", "Today", "visit-1042"]]);

  const day7 = await api.checkIns.reply({ checkInId: "check-in:visit-1042:7", text: "Sudah sihat, terima kasih" });
  expect(day7.replies).toMatchObject([{ label: "fine", task: null }]);
  expect((await api.tasks.list()).filter(t => t.kind === "check-in")).toHaveLength(1);
});

test("chest pain or severe breathlessness in any language reads as urgent", async () => {
  const { api } = await discharged();
  for (const text of ["Sesak nafas teruk malam tadi", "chest pain since this morning", "胸痛"]) {
    const [reply] = (await api.checkIns.reply({ checkInId: "check-in:visit-1042:2", text })).replies.slice(-1);
    expect([text, reply?.label]).toEqual([text, "urgent"]);
  }
});

test("check-ins need a signed-in doctor, and another hospital's doctor cannot see or answer them", async () => {
  const { db, api, as } = await discharged();
  const anonymous = as(null);
  for (const call of [() => anonymous.checkIns.list(), () => anonymous.checkIns.tick(), () => anonymous.checkIns.reply({ checkInId: "check-in:visit-1042:2", text: "ok" })])
    expect((await call().catch(e => e)).code).toBe("UNAUTHORIZED");
  await db.insert(hospitals).values({ id: "other", name: "Other Hospital (synthetic)" });
  await db.insert(hospitalMembers).values({ userId: "dr-other", hospitalId: "other" });
  const theirs = as("dr-other");
  expect(await theirs.checkIns.list()).toEqual([]);
  expect((await theirs.checkIns.reply({ checkInId: "check-in:visit-1042:2", text: "demam balik" }).catch(e => e)).code).toBe("NOT_FOUND");
  expect((await api.checkIns.list())[0]?.replies).toEqual([]);
});
