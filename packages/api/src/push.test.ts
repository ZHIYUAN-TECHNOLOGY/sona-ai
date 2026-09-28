import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { encounters, guaranteeLetters, pushTokens } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { EXPO_PUSH_URL, notifyPatient, pushFor, registerPushToken, when } from "./push";
import { appRouter } from "./routers/index";

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

/** A stand-in for Expo's push service: records each batch and answers with the given tickets. */
function fakeExpo(tickets: (messages: { to: string }[]) => unknown[] = m => m.map(() => ({ status: "ok", id: "x" }))) {
  const sent: { url: string; messages: { to: string; title: string; body: string; data: { url: string } }[] }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const messages = JSON.parse(String(init.body));
    sent.push({ url, messages });
    return Response.json({ data: tickets(messages) });
  }) as unknown as typeof globalThis.fetch;
  return { sent, fetch };
}

test("times read as Kuala Lumpur, in English or Malay", () => {
  const at = new Date("2026-10-01T09:00:00+08:00");
  expect(when(at, "en")).toBe("Thu 1 Oct, 9:00 AM");
  expect(when(at, "ms")).toBe("Kha 1 Okt, 9:00 PG");
  expect(pushFor({ kind: "reply" }, "en")).toEqual({ title: "Messages", body: "Your care team replied", data: { url: "sona-care:///messages" } });
});

test("notifyPatient sends one batch to the patient's phones, forgets unregistered ones and never throws", async () => {
  const db = await createTestDb();
  await seedDemo(db);
  for (const token of ["ExponentPushToken[a]", "ExponentPushToken[b]"]) await registerPushToken(db, { token, platform: "ios", userId: "amelia-account", hospitalId: "demo", patientId: "SYN-1042" });
  const expo = fakeExpo(m => m.map(x => (x.to.endsWith("[b]") ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok", id: "1" })));
  const push = pushFor({ kind: "check-in", day: 2 }, "en");

  await notifyPatient({ db, fetch: expo.fetch }, "demo", "SYN-1042", push);
  expect(expo.sent).toHaveLength(1);
  expect(expo.sent[0]!.url).toBe(EXPO_PUSH_URL);
  expect(expo.sent[0]!.messages.map(m => m.to)).toEqual(["ExponentPushToken[a]", "ExponentPushToken[b]"]);
  expect(expo.sent[0]!.messages[0]).toMatchObject({ body: "How are you feeling today? Your day-2 check-in is ready", data: { url: "sona-care:///check-ins" } });
  expect((await db.select().from(pushTokens)).map(t => t.token)).toEqual(["ExponentPushToken[a]"]);

  // No phones: nothing is sent. A failing push service: the caller carries on.
  await notifyPatient({ db, fetch: expo.fetch }, "demo", "SYN-1086", push);
  expect(expo.sent).toHaveLength(1);
  const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
  expect(await notifyPatient({ db, fetch: down }, "demo", "SYN-1042", push)).toBeUndefined();
});

test("only a joined patient registers a phone, the token follows its latest account, and Book in pushes to it in her language", async () => {
  const now = new Date("2026-09-28T10:05:00+08:00");
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T15:40:00+08:00"));
  await addClinician(db, "dr-aisyah");
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: now }).where(eq(guaranteeLetters.id, "gl-1042"));
  await db.update(encounters).set({ state: { discharge: { glReceived: true, medsConfirmed: true, followUp: "2w", language: "ms" } } }).where(eq(encounters.id, "visit-1042"));
  const expo = fakeExpo();
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), now: () => now, fetch: expo.fetch } });
  const doctor = as("dr-aisyah"), amelia = as("amelia-account");
  const phone = { token: "ExponentPushToken[amelia]", platform: "ios" as const };

  // Before joining, and as a clinician, there is no patient to register for.
  expect((await amelia.care.push.register(phone).catch(e => e)).code).toBe("FORBIDDEN");
  expect((await doctor.care.push.register(phone).catch(e => e)).code).toBe("FORBIDDEN");

  await doctor.discharge.request({ encounterId: "visit-1042", requestId: "req-d1", approvedBy: "dr-aisyah" });
  await amelia.care.join({ code: (await doctor.care.code({ encounterId: "visit-1042" })).code });
  await amelia.care.push.register(phone);
  await amelia.care.push.register(phone);
  expect(await db.select({ token: pushTokens.token, patientId: pushTokens.patientId, userId: pushTokens.userId }).from(pushTokens))
    .toEqual([{ token: phone.token, patientId: "SYN-1042", userId: "amelia-account" }]);

  const flagged = (await amelia.care.checkIns.reply({ checkInId: "check-in:visit-1042:2", text: "demam balik" })).replies[0]!.task!;
  await doctor.checkIns.bookIn({ taskId: flagged.id });
  expect(expo.sent.at(-1)!.messages).toEqual([{
    to: phone.token, sound: "default", title: "Temu janji", body: "Doktor anda telah membuat temu janji · Sel 29 Sep, 9:00 PG", data: { url: "sona-care:///follow-ups" },
  }] as never);

  // The care team's reply reaches her too; after unregistering, nothing does.
  await doctor.messages.reply({ patientId: "SYN-1042", text: "Datang esok", requestId: "r1" });
  expect(expo.sent.at(-1)!.messages[0]).toMatchObject({ body: "Pasukan penjagaan anda telah membalas", data: { url: "sona-care:///messages" } });
  await amelia.care.push.unregister({ token: phone.token });
  const count = expo.sent.length;
  await doctor.messages.reply({ patientId: "SYN-1042", text: "Jumpa esok", requestId: "r2" });
  expect(expo.sent).toHaveLength(count);
});

test("a due check-in pushes once per patient, from the demo clock's jump too", async () => {
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T15:40:00+08:00"));
  await addClinician(db, "dr-aisyah");
  const now = new Date("2026-09-26T16:00:00+08:00");
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: now }).where(eq(guaranteeLetters.id, "gl-1042"));
  await db.update(encounters).set({ state: { discharge: { glReceived: true, medsConfirmed: true, followUp: "2w", language: "en" } } }).where(eq(encounters.id, "visit-1042"));
  const expo = fakeExpo();
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), now: () => now, fetch: expo.fetch } });
  const doctor = as("dr-aisyah"), amelia = as("amelia-account");
  await doctor.discharge.request({ encounterId: "visit-1042", requestId: "req-d1", approvedBy: "dr-aisyah" });
  await amelia.care.join({ code: (await doctor.care.code({ encounterId: "visit-1042" })).code });
  await amelia.care.push.register({ token: "ExponentPushToken[amelia]", platform: "ios" });

  await doctor.demo.jump({ to: "day-2" });
  expect(expo.sent.flatMap(s => s.messages.map(m => m.body))).toEqual(["How are you feeling today? Your day-2 check-in is ready"]);
});
