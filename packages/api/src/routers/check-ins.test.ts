import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { careMessages, encounters, guaranteeLetters, hospitalMembers, hospitals, tasks } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb, type TestDb } from "@sona-ai/db/testing";
import type { FollowUp } from "@sona-ai/domain/check-in-agent";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { Context, FollowUps } from "../context";
import type { Change } from "../events";
import { registerPushToken } from "../push";
import { runFollowUp, sendDueCheckIns, wakeFollowUps } from "./check-ins";
import { appRouter } from "./index";

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

/** Amelia discharged with every blocker cleared and her leaflet in `language`; the clock can then jump days. `pick` runs before the discharge. */
async function discharged(language = "ms", pick?: (api: ReturnType<typeof createRouterClient<typeof appRouter>>) => Promise<unknown>, extra?: (db: TestDb, clock: { now: Date }) => Partial<Context>) {
  const clock = { now: new Date("2026-09-26T15:40:00+08:00") };
  const db = await createTestDb();
  await seedDemo(db, clock.now);
  await addClinician(db, "dr-aisyah");
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: clock.now }).where(eq(guaranteeLetters.id, "gl-1042"));
  await db.update(encounters).set({ state: { discharge: { glReceived: true, medsConfirmed: true, followUp: "2w", language } } }).where(eq(encounters.id, "visit-1042"));
  const more = extra?.(db, clock);
  const as = (id: string | null) => createRouterClient(appRouter, { context: { db, session: id ? user(id) : null, now: () => clock.now, ...more } });
  const api = as("dr-aisyah");
  await pick?.(api);
  await api.discharge.request({ encounterId: "visit-1042", requestId: "req-d1", approvedBy: "dr-aisyah" });
  return { db, clock, api, as };
}

test("the doctor's check-in days go with the discharge: the cron, Sona Care's plan and the demo jumps follow them", async () => {
  const { db, clock, api, as } = await discharged("en", api => api.discharge.update({ encounterId: "visit-1042", checkInDays: [1, 3, 14] }));
  const list = await api.checkIns.list({ encounterId: "visit-1042" });
  expect(list.map(c => [c.day, c.dueAt.toISOString()])).toEqual([
    [1, "2026-09-27T02:00:00.000Z"], [3, "2026-09-29T02:00:00.000Z"], [14, "2026-10-10T02:00:00.000Z"],
  ]);
  const [row] = await db.select({ state: encounters.state }).from(encounters).where(eq(encounters.id, "visit-1042"));
  expect((row!.state as { discharge: { checkInDays: number[] } }).discharge.checkInDays).toEqual([1, 3, 14]);
  // The hourly send on day 3 sends day 1 and day 3, not day 14.
  clock.now = new Date("2026-09-29T10:30:00+08:00");
  expect((await sendDueCheckIns(db, "demo", clock.now)).sent).toBe(2);
  // Sona Care's plan lists the same days.
  const { code } = await api.care.code({ encounterId: "visit-1042" });
  const amelia = as("amelia-account");
  await amelia.care.join({ code });
  const plan = await amelia.care.discharge();
  expect(plan.status === "discharged" && plan.checkIns.map(c => c.day)).toEqual([1, 3, 14]);
  // The demo's check-in jumps land on the first two chosen days.
  clock.now = new Date("2026-09-26T15:40:00+08:00");
  expect((await api.demo.status()).checkInDays).toEqual([1, 3]);
  expect((await api.demo.jump({ to: "day-2" })).now.toISOString()).toBe(new Date("2026-09-27T10:01:00+08:00").toISOString());
  expect((await api.demo.jump({ to: "day-7" })).now.toISOString()).toBe(new Date("2026-09-29T10:01:00+08:00").toISOString());
});

test("days sent with the discharge win; bad picks are refused; none chosen means the condition's suggestion", async () => {
  const { api } = await discharged("en", async api => {
    for (const bad of [[], [0], [31], [7, 2], [2, 2], [1, 2, 3, 5, 7, 10, 14], [2.5]])
      expect((await api.discharge.update({ encounterId: "visit-1042", checkInDays: bad }).catch(e => e)).code).toBe("BAD_REQUEST");
    await api.discharge.update({ encounterId: "visit-1042", checkInDays: [5] });
    expect((await api.discharge.request({ encounterId: "visit-1042", requestId: "req-bad", approvedBy: "dr-aisyah", checkInDays: [3, 1] }).catch(e => e)).code).toBe("BAD_REQUEST");
    await api.discharge.request({ encounterId: "visit-1042", requestId: "req-days", approvedBy: "dr-aisyah", checkInDays: [2, 10] });
  });
  expect((await api.checkIns.list({ encounterId: "visit-1042" })).map(c => c.day)).toEqual([2, 10]);
  // Amelia's pneumonia suggests day 2 and day 7 when nothing was picked (the fixture above).
  const plain = await discharged("en");
  expect((await plain.api.checkIns.list({ encounterId: "visit-1042" })).map(c => c.day)).toEqual([2, 7]);
});

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
  expect(await sendDueCheckIns(db, "demo", clock.now)).toEqual({ sent: 0, patientIds: [] });
  expect(await sendDueCheckIns(db, "other", new Date("2026-10-10T00:00:00Z"))).toEqual({ sent: 0, patientIds: [] });
  const monday = new Date("2026-09-28T10:00:00+08:00");
  expect(await sendDueCheckIns(db, "demo", monday)).toEqual({ sent: 1, patientIds: ["SYN-1042"] });
  expect(await sendDueCheckIns(db, "demo", new Date("2026-09-28T11:00:00+08:00"))).toEqual({ sent: 0, patientIds: [] });
  clock.now = new Date("2026-10-03T10:30:00+08:00");
  expect(await api.checkIns.tick()).toEqual({ sent: 1, patientIds: ["SYN-1042"] });
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

/**
 * The Worker's check-in agents, in memory: the same wake (runFollowUp) with each visit's state kept
 * between wakes, as the Durable Object keeps it. `wakes` holds each agent's next alarm (real time).
 */
function memoryAgents(base: Pick<Context, "db" | "fetch" | "announce" | "now">) {
  const state = new Map<string, FollowUp>(), wakes = new Map<string, Date | undefined>();
  const followUps: FollowUps = {
    async tick(hospitalId, encounterId) {
      const { followUp, sent, wakeAt } = await runFollowUp(base, hospitalId, encounterId, state.get(encounterId));
      if (followUp) state.set(encounterId, followUp); else state.delete(encounterId);
      wakes.set(encounterId, wakeAt);
      return { sent };
    },
    get: async (hospitalId, encounterId) => (state.get(encounterId)?.hospitalId === hospitalId ? state.get(encounterId)! : null),
  };
  return { followUps, wakes };
}

/** A stand-in for Expo's push service that records what each phone was told. */
function fakeExpo() {
  const told: { title: string; body: string; data: { url: string } }[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    const messages = JSON.parse(String(init.body)) as typeof told;
    told.push(...messages);
    return Response.json({ data: messages.map(() => ({ status: "ok", id: "x" })) });
  }) as unknown as typeof globalThis.fetch;
  return { told, fetch };
}

/** Amelia discharged (Malay leaflet) with her phone registered, her visit followed by its check-in agent. */
async function followed() {
  const expo = fakeExpo(), heard: Change[] = [];
  let agents!: ReturnType<typeof memoryAgents>;
  const world = await discharged("ms", async () => {}, (db, clock) => {
    const base = { db, fetch: expo.fetch, announce: async (_: string, change: Change) => { heard.push(change); }, now: () => clock.now };
    agents = memoryAgents(base);
    return { ...base, followUps: agents.followUps };
  });
  await registerPushToken(world.db, { token: "ExponentPushToken[amelia]", platform: "ios", userId: "amelia-account", hospitalId: "demo", patientId: "SYN-1042" });
  return { ...world, expo, heard, agents };
}
const followUpOf = async (api: Awaited<ReturnType<typeof followed>>["api"]) => (await api.checkIns.followUp({ encounterId: "visit-1042" }))!;

test("the check-in agent starts at discharge, sends day 2 on the demo clock and asks again once after 2 h of silence", async () => {
  const { api, expo, agents, heard } = await followed();
  const start = await followUpOf(api);
  expect(start.timeline.map(e => e.text)).toEqual(["Following up: check-ins on day 2 and day 7"]);
  expect(start.next).toEqual({ at: "2026-09-28T02:00:00.000Z", text: "Day-2 check-in" });
  // Its alarm is set for the day-2 check-in (real time; the demo clock is still at 0).
  expect(agents.wakes.get("visit-1042")?.toISOString()).toBe("2026-09-28T02:00:00.000Z");

  // The demo jumps to day 2: the agent sends the check-in through the usual path (her Sona Care, a push).
  await api.demo.jump({ to: "day-2" });
  expect((await api.checkIns.list({ encounterId: "visit-1042" })).map(c => [c.day, c.sentAt?.toISOString()])).toEqual([[2, "2026-09-28T02:01:00.000Z"], [7, undefined]]);
  expect(expo.told.map(m => m.title)).toEqual(["Semakan"]);
  expect(heard).toContainEqual({ topic: "checkIns", encounterId: "visit-1042", patientId: "SYN-1042" });
  const sent = await followUpOf(api);
  expect(sent.timeline.at(-1)).toEqual({ at: "2026-09-28T02:01:00.000Z", text: "Sent day-2 check-in", tone: "neutral" });
  expect(sent.next).toEqual({ at: "2026-09-28T04:01:00.000Z", text: "Ask again if no reply" });
  // Its alarm follows the demo clock: 12:01 demo time, less the offset, in real time.
  const offset = Date.parse("2026-09-28T02:01:00.000Z") - Date.parse("2026-09-26T07:40:00.000Z");
  expect(agents.wakes.get("visit-1042")?.getTime()).toBe(Date.parse("2026-09-28T04:01:00.000Z") - offset);

  // No reply: skipping to its next step (12:02), it asks again once, gently, in her language.
  await api.demo.jump({ to: "next", encounterId: "visit-1042" });
  expect(expo.told.at(-1)).toMatchObject({ title: "Semakan", body: "Sekadar bertanya lagi: apa khabar hari ini? Semakan hari ke-2 anda menunggu bila anda bersedia", data: { url: "sona-care:///check-ins" } });
  const asked = await followUpOf(api);
  expect(asked.timeline.at(-1)).toEqual({ at: "2026-09-28T04:02:00.000Z", text: "No reply after 2 h; asked again", tone: "neutral" });
  expect(asked.next?.text).toBe("Day-7 check-in");
  await api.checkIns.tick();
  expect(expo.told).toHaveLength(2);
  // "next" needs a visit whose agent has something planned.
  expect((await api.demo.jump({ to: "next" }).catch(e => e)).code).toBe("BAD_REQUEST");
});

test("a worse reply brings the next check-in to tomorrow; an urgent one from Sona Care tells her to call 999 at once", async () => {
  const { api, as, db, expo, heard, clock } = await followed();
  await api.demo.jump({ to: "day-2" });
  clock.now = new Date("2026-09-26T15:45:00+08:00"); // five minutes later on the demo clock

  // The clinician's "Simulate reply" goes through the same reading, then the agent.
  await api.checkIns.reply({ checkInId: "check-in:visit-1042:2", text: "demam balik" });
  expect((await api.checkIns.list({ encounterId: "visit-1042" })).map(c => [c.day, c.dueAt.toISOString()])).toEqual([
    [2, "2026-09-28T02:00:00.000Z"], [3, "2026-09-29T02:00:00.000Z"], [7, "2026-10-03T02:00:00.000Z"],
  ]);
  const worse = await followUpOf(api);
  expect(worse.timeline.at(-1)).toEqual({ at: "2026-09-28T02:06:00.000Z", text: "Reply read as worse: fever returned; task for the care team; next check-in tomorrow", tone: "amber" });
  expect(worse.next).toEqual({ at: "2026-09-29T02:00:00.000Z", text: "Day-3 check-in" });

  // Day 3 arrives: the brought-forward check-in goes out like any other.
  await api.demo.jump({ to: "next", encounterId: "visit-1042" });
  expect((await followUpOf(api)).timeline.at(-1)?.text).toBe("Sent day-3 check-in");

  // Her urgent reply in Sona Care: an urgent task, the 999 template in her thread and on her phone, Sona Pro told.
  const { code } = await api.care.code({ encounterId: "visit-1042" });
  const amelia = as("amelia-account");
  await amelia.care.join({ code });
  heard.length = 0;
  await amelia.care.checkIns.reply({ checkInId: "check-in:visit-1042:3", text: "Sakit dada sejak pagi" });
  const call = "Hai Amelia, sila hubungi 999 atau pergi ke jabatan kecemasan terdekat sekarang. Jangan tunggu balasan di sini. Pasukan penjagaan anda akan menelefon anda.";
  expect((await amelia.care.messages.list()).map(m => [m.from, m.text])).toEqual([["care-team", call]]);
  expect(expo.told.at(-1)).toMatchObject({ title: "Hubungi 999 sekarang", body: call, data: { url: "sona-care:///messages" } });
  expect(heard).toEqual(expect.arrayContaining([{ topic: "checkIns", encounterId: "visit-1042", patientId: "SYN-1042" }, { topic: "messages", patientId: "SYN-1042" }]));
  expect((await db.select({ title: tasks.title }).from(tasks).where(eq(tasks.kind, "check-in"))).map(t => t.title).sort())
    .toEqual(["Amelia: chest pain after discharge", "Amelia: fever returned after discharge"]);
  expect((await followUpOf(api)).timeline.at(-1)).toMatchObject({ text: "Reply read as urgent: chest pain; told to call 999 now; urgent task for the care team", tone: "red" });

  // Another wake tells her nothing twice.
  const pushes = expo.told.length;
  await api.checkIns.tick();
  expect([expo.told.length, (await db.select().from(careMessages)).length]).toEqual([pushes, 1]);
});

test("the backstop wakes an existing discharged visit's agent; a failing agent never holds a check-in back; other hospitals see nothing", async () => {
  const { db, api, as } = await discharged();
  const day2 = new Date("2026-09-28T10:01:00+08:00");
  const agents = memoryAgents({ db, now: () => day2 });
  // Discharged before agents existed: its agent starts on the first wake and sends what is due.
  expect(await wakeFollowUps({ db, followUps: agents.followUps }, "demo", day2)).toEqual({ sent: 1, patientIds: ["SYN-1042"] });
  expect((await agents.followUps.get("demo", "visit-1042"))?.timeline.map(e => e.text)).toEqual(["Following up: check-ins on day 2 and day 7", "Sent day-2 check-in"]);
  expect(await agents.followUps.get("other", "visit-1042")).toBeNull();

  const down: FollowUps = { tick: async () => { throw new Error("agent down"); }, get: async () => null };
  const day7 = new Date("2026-10-03T10:01:00+08:00");
  expect(await wakeFollowUps({ db, followUps: down }, "demo", day7)).toEqual({ sent: 1, patientIds: ["SYN-1042"] });

  // Without agents the follow-up reads null; another hospital's doctor cannot ask for this visit's.
  expect(await api.checkIns.followUp({ encounterId: "visit-1042" })).toBeNull();
  await db.insert(hospitals).values({ id: "other", name: "Other Hospital (synthetic)" });
  await db.insert(hospitalMembers).values({ userId: "dr-other", hospitalId: "other" });
  expect((await as("dr-other").checkIns.followUp({ encounterId: "visit-1042" }).catch(e => e)).code).toBe("NOT_FOUND");
});
