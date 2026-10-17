import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { accessLogs } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { boxState, type Baseten } from "../baseten-models";
import type { Change } from "../events";
import { wakeWatches, watchData, watchKeeper, type WatchBook, type Watches } from "../watches";
import { appRouter } from "./index";

// Each test starts knowing nothing about the boxes (the adapter keeps what it learns for the isolate).
beforeEach(() => boxState.clear());

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

/** The Worker's watch agents, in memory: the same keeper with each clinician's book kept between steps. `wakes` holds each agent's next alarm. */
function memoryWatches(deps: Parameters<typeof watchKeeper>[0]) {
  const books = new Map<string, WatchBook>(), wakes = new Map<string, Date | undefined>();
  const of = (hospitalId: string, userId: string) => watchKeeper(deps, { get: () => books.get(userId) ?? null, set: book => { books.set(userId, book); } }, hospitalId, userId);
  const watches: Watches = {
    list: async (h, u) => of(h, u).list(),
    add: async (h, u, watch) => { const done = await of(h, u).add(watch); wakes.set(u, done.wakeAt); return done.watch; },
    remove: async (h, u, id) => { wakes.set(u, (await of(h, u).remove(id)).wakeAt); },
    tick: async (h, u) => { const done = await of(h, u).tick(); wakes.set(u, done.wakeAt); return { ran: done.ran }; },
  };
  return { watches, wakes };
}

/** The demo hospital with a doctor, a nurse and a bed manager; `reply` is what the model answers (none: no model at all). */
async function world(reply?: () => Response) {
  const clock = { now: new Date("2026-09-26T15:40:00+08:00") };
  const db = await createTestDb();
  await seedDemo(db, clock.now);
  await addClinician(db, "dr-aisyah");
  await addClinician(db, "nurse-lee", undefined, "nurse");
  await addClinician(db, "beds", undefined, "bed-manager");
  const heard: Change[] = [];
  const baseten: Baseten | undefined = reply && { apiKey: "k", fetcher: (async () => reply()) as unknown as typeof fetch };
  const base = { db, baseten, now: () => clock.now, announce: async (_: string, change: Change) => { heard.push(change); } };
  const agents = memoryWatches(base);
  const as = (id: string, on = true) => createRouterClient(appRouter, { context: { ...base, session: user(id), ...(on ? { watches: agents.watches } : {}) } });
  return { db, clock, heard, agents, as };
}

/** Gemma answering with Daniel's potassium, the row copied as the data gives it. */
async function potassium(db: Parameters<typeof watchData>[0]) {
  const row = (await watchData(db, "demo")).rows.find(r => r.id === "lab-1086-potassium")!;
  const spec = { root: "f", elements: {
    f: { type: "AskColumn", props: {}, children: ["f-0", "f-1"] },
    "f-0": { type: "AskLead", props: { text: `${row.title} has low potassium.` }, children: [] },
    "f-1": { type: "AskRows", props: { rows: [row] }, children: [] },
  } };
  return { row, answer: () => Response.json({ choices: [{ message: { content: JSON.stringify(spec) } }] }) };
}

test("a new watch is asked at once, answered from the hospital's results, kept for its clinician only, and on the access trail", async () => {
  let answer = () => new Response("down", { status: 500 });
  const { db, heard, as } = await world(() => answer());
  const { row, answer: gemma } = await potassium(db);
  expect(row).toMatchObject({ detail: "Potassium 3.1 mmol/L · low · not yet acknowledged", tone: "soon", op: "open:SYN-1086" });
  answer = gemma;

  const doctor = as("dr-aisyah");
  const watch = await doctor.watches.create({ requestId: "w1", question: "Who has low potassium?", hour: 7 });
  expect(watch).toMatchObject({ id: "w1", question: "Who has low potassium?", hour: 7, last: { source: "model", at: "2026-09-26T07:40:00.000Z" } });
  expect(watch.last?.source === "model" && watch.last.spec.elements["f-1"]!.props.rows).toEqual([row]);
  // Replaying the request keeps one watch and does not ask again.
  expect(await doctor.watches.create({ requestId: "w1", question: "Who has low potassium?", hour: 7 })).toEqual(watch);
  expect(await doctor.watches.list()).toEqual([watch]);
  expect(await as("nurse-lee").watches.list()).toEqual([]);
  // The watch's own run and the create are both announced; the answer named Daniel, so the trail says who saw him.
  expect(heard).toEqual([{ topic: "watches" }, { topic: "watches" }, { topic: "watches" }]);
  expect((await db.select().from(accessLogs).where(eq(accessLogs.route, "watches.run"))).map(l => [l.userId, l.patientId])).toEqual([["dr-aisyah", "SYN-1086"]]);

  await doctor.watches.remove({ watchId: "w1" });
  expect(await doctor.watches.list()).toEqual([]);
});

test("a watch is asked again once a day at its hour, and a clock jump wakes every clinician's agent", async () => {
  const { db, clock, agents, as } = await world();
  await as("dr-aisyah").watches.create({ requestId: "w1", question: "Who has low potassium?", hour: 7 });
  await as("nurse-lee").watches.create({ requestId: "w2", question: "Which tasks are open?", hour: 20 });
  // The alarms: tomorrow 07:00 and tonight 20:00, in Malaysia.
  expect(agents.wakes.get("dr-aisyah")?.toISOString()).toBe(new Date("2026-09-27T07:00:00+08:00").toISOString());
  expect(agents.wakes.get("nurse-lee")?.toISOString()).toBe(new Date("2026-09-26T20:00:00+08:00").toISOString());
  expect(await agents.watches.tick("demo", "dr-aisyah")).toEqual({ ran: 0 });

  clock.now = new Date("2026-09-27T07:05:00+08:00");
  expect(await wakeWatches({ db, watches: agents.watches }, "demo")).toEqual({ ran: 2 });
  expect(await wakeWatches({ db, watches: agents.watches }, "demo")).toEqual({ ran: 0 });
  // No model here: the answer is a labelled fixture, never an invented one.
  expect((await as("dr-aisyah").watches.list())[0]!.last).toEqual({ at: "2026-09-26T23:05:00.000Z", source: "fixture" });
});

test("a starting model is asked once more five minutes later, then left until the next day", async () => {
  const { clock, agents, as } = await world(() => new Response("starting", { status: 503 }));
  const watch = await as("dr-aisyah").watches.create({ requestId: "w1", question: "Who has low potassium?", hour: 7 });
  expect(watch.last?.source).toBe("fixture");
  expect(agents.wakes.get("dr-aisyah")?.toISOString()).toBe(new Date("2026-09-26T15:45:00+08:00").toISOString());
  clock.now = new Date("2026-09-26T15:45:00+08:00");
  expect(await agents.watches.tick("demo", "dr-aisyah")).toEqual({ ran: 1 });
  expect((await agents.watches.list("demo", "dr-aisyah"))[0]!.last).toMatchObject({ source: "fixture", retried: true });
  expect(await agents.watches.tick("demo", "dr-aisyah")).toEqual({ ran: 0 });
  expect(agents.wakes.get("dr-aisyah")?.toISOString()).toBe(new Date("2026-09-27T07:00:00+08:00").toISOString());
});

test("five watches at most; bed managers have none; without agents nothing is kept", async () => {
  const { as } = await world();
  const doctor = as("dr-aisyah");
  for (let i = 0; i < 5; i++) await doctor.watches.create({ requestId: `w${i}`, question: "Which tasks are open?", hour: 7 });
  expect((await doctor.watches.create({ requestId: "w5", question: "Which tasks are open?", hour: 7 }).catch(e => e)).code).toBe("BAD_REQUEST");
  expect((await as("beds").watches.list().catch(e => e)).code).toBe("FORBIDDEN");
  expect(await as("dr-aisyah", false).watches.list()).toEqual([]);
  expect((await as("dr-aisyah", false).watches.create({ requestId: "w9", question: "Which tasks are open?", hour: 7 }).catch(e => e)).code).toBe("PRECONDITION_FAILED");
});
