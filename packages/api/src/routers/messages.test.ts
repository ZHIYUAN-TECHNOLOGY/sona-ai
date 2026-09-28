import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { user as users } from "@sona-ai/db/schema/auth";
import { encounters } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { Change } from "../events";
import { stubModels, type Models } from "../models";
import { appRouter } from "./index";
import { staffName } from "./messages";

const session = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

/** A doctor, a nurse and management; Amelia (SYN-1042) and Daniel (SYN-1086) on Sona Care; one clock. */
async function world(models?: Models) {
  const db = await createTestDb();
  const clock = { now: new Date("2026-09-26T10:00:00+08:00") };
  await seedDemo(db, clock.now);
  await db.insert(users).values([{ id: "dr", name: "Dr Test Aisyah", email: "dr@sona.test" }, { id: "nurse", name: "Nurse Test Mei Ling", email: "nurse@sona.test" }]);
  await addClinician(db, "dr");
  await addClinician(db, "nurse", undefined, "nurse");
  await addClinician(db, "boss", undefined, "management");
  const heard: Change[] = [];
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: session(id), now: () => clock.now, models, announce: async (_: string, c: Change) => { heard.push(c); } } });
  const doctor = as("dr"), nurse = as("nurse"), amelia = as("amelia"), farid = as("farid");
  await amelia.care.join({ code: (await doctor.care.code({ encounterId: "visit-1042" })).code });
  await farid.care.join({ code: (await doctor.care.code({ encounterId: "visit-1086" })).code });
  const later = (minutes: number) => { clock.now = new Date(clock.now.getTime() + minutes * 60_000); };
  let n = 0;
  const send = (who: typeof amelia, text: string) => who.care.messages.send({ text, requestId: `r${++n}` });
  return { db, clock, heard, doctor, nurse, manager: as("boss"), amelia, farid, later, send };
}

test("names in the thread: the patient's first name, and staff titled by role", () => {
  expect(staffName("Dr Test Aisyah", "doctor")).toBe("Dr Aisyah");
  expect(staffName("Nurse Test Mei Ling", "nurse")).toBe("Nurse Mei Ling");
  expect(staffName(null, null)).toBe("Care team");
});

test("a patient's message is triaged when sent; a failed triage never stops the send", async () => {
  const { amelia, send, doctor } = await world();
  await send(amelia, "Sakit dada sejak pagi");
  const [row] = (await doctor.messages.inbox()).threads;
  expect(row).toMatchObject({ patientId: "SYN-1042", label: "urgent", reason: "Mentions “sakit dada”: possible emergency", unread: 1, waiting: 1, handled: false });

  const broken = await world({ ...stubModels, triageMessage: async () => { throw new Error("model down"); } });
  expect((await broken.send(broken.amelia, "Hello?")).text).toBe("Hello?");
  expect((await broken.doctor.messages.inbox()).threads[0]).toMatchObject({ label: "clinical", reason: "Not triaged: read it first" });
});

test("the inbox puts urgent first, then the longest waiting; a handled thread drops below, and an answered one is handled", async () => {
  const { amelia, farid, doctor, nurse, manager, later, send } = await world();
  await send(amelia, "When is my next appointment?");
  later(30);
  await send(farid, "Can I take paracetamol with my other tablets?");
  later(30);
  await send(amelia, "Also I am breathless when I walk");
  let inbox = await nurse.messages.inbox();
  expect(inbox.threads.map(t => [t.name, t.label, t.waiting, t.unread])).toEqual([["Amelia Tan", "urgent", 2, 2], ["Daniel Rahman", "clinical", 1, 1]]);
  expect(inbox.threads[0]!.waitingSince).toEqual(new Date("2026-09-26T02:00:00.000Z"));
  expect(inbox.threads[0]!.lastText).toBe("Also I am breathless when I walk");

  // Amelia is answered; Farid's needs no reply. Both drop to handled, newest first, and their tasks close.
  later(2);
  await doctor.messages.reply({ patientId: "SYN-1042", text: "Please call 999 now.", requestId: "a1" });
  expect(await nurse.messages.handle({ patientId: "SYN-1086" })).toEqual({ handled: 1 });
  inbox = await manager.messages.inbox();
  expect(inbox.threads.map(t => [t.name, t.handled, t.label, t.lastFrom])).toEqual([["Amelia Tan", true, null, "care-team"], ["Daniel Rahman", true, null, "patient"]]);
  expect((await doctor.tasks.list()).filter(t => t.kind === "message").every(t => t.completed)).toBe(true);

  // A new message reopens the thread; a week later a handled thread leaves the inbox.
  await send(farid, "Thank you");
  expect((await nurse.messages.inbox()).threads[0]).toMatchObject({ name: "Daniel Rahman", handled: false, label: "clinical" });
  later(8 * 24 * 60);
  expect((await nurse.messages.inbox()).threads.map(t => t.name)).toEqual(["Daniel Rahman"]);
});

test("opening the thread as care staff marks the patient's messages seen and tells Sona Care; management's read does not", async () => {
  const { amelia, doctor, manager, heard, later, send } = await world();
  await send(amelia, "Is a little cough normal?");
  later(4);
  await manager.messages.thread({ patientId: "SYN-1042" });
  expect((await amelia.care.messages.list())[0]!.seenAt).toBeNull();
  heard.length = 0;
  const opened = await doctor.messages.thread({ patientId: "SYN-1042" });
  expect(opened.patient).toMatchObject({ id: "SYN-1042", name: "Amelia Tan", encounterId: "visit-1042" });
  expect(opened.messages.map(m => [m.author, m.from, m.unanswered])).toEqual([["Amelia", "patient", true]]);
  expect(heard).toEqual([{ topic: "messages", patientId: "SYN-1042" }]);
  expect((await amelia.care.messages.list())[0]!.seenAt).toEqual(new Date("2026-09-26T02:04:00.000Z"));
  // Already seen: a second open changes nothing and says nothing.
  heard.length = 0;
  await doctor.messages.thread({ patientId: "SYN-1042" });
  expect(heard).toEqual([]);
  expect((await doctor.messages.inbox()).threads[0]!.unread).toBe(0);

  await doctor.messages.reply({ patientId: "SYN-1042", text: "Yes, for a week or two.", requestId: "a1" });
  expect((await doctor.messages.list({ patientId: "SYN-1042" })).map(m => m.author)).toEqual(["Amelia", "Dr Aisyah"]);
});

test("Sona's draft answers the latest waiting message from the patient's own plan, labelled as a rule-based fixture", async () => {
  const { db, amelia, nurse, send, manager } = await world();
  expect(await nurse.messages.draft({ patientId: "SYN-1042" })).toBeNull();
  await db.update(encounters).set({ state: { discharge: { glReceived: true, medsConfirmed: true, followUp: "2w", language: "ms", dischargedAt: "2026-09-26T07:40:00.000Z" } } }).where(eq(encounters.id, "visit-1042"));
  await send(amelia, "Berapa lama lagi saya perlu makan azithromycin?");
  const draft = await nurse.messages.draft({ patientId: "SYN-1042" });
  expect(draft).toMatchObject({ label: "clinical", source: "fixture" });
  expect(draft!.text).toBe("Hai Amelia, tentang Azithromycin anda: Kini sebiji tablet sehari, selama 2 hari lagi. Jika ada perkara lain yang merisaukan, jururawat boleh menelefon anda hari ini.");

  await send(amelia, "Bila temu janji saya?");
  expect((await nurse.messages.draft({ patientId: "SYN-1042" }))!.text).toContain("Sab 10 Okt, 3:40 PTG");
  await send(amelia, "我胸痛");
  const urgent = await nurse.messages.draft({ patientId: "SYN-1042" });
  expect([urgent!.label, urgent!.text.includes("999"), /[一-鿿]/.test(urgent!.text)]).toEqual(["urgent", true, true]);
  expect((await manager.messages.draft({ patientId: "SYN-1042" }).catch(e => e)).code).toBe("FORBIDDEN");
});
