import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { user } from "@sona-ai/db/schema/auth";
import { encounters, hospitals } from "@sona-ai/db/schema/clinical";
import { eq } from "drizzle-orm";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";

import type { Context } from "../context";
import { stubModels } from "../models";
import { appRouter } from "./index";

const session = {
  user: { id: "dr-aisyah", name: "Dr Aisyah", email: "aisyah@demo.test", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: "s1", userId: "dr-aisyah", token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session;

async function signedIn(extra: Partial<Context> = {}, signed = true) {
  const db = extra.db ?? await createTestDb();
  await seedDemo(db, new Date("2026-09-26T09:00:00+08:00"));
  await addClinician(db, "dr-aisyah");
  // Colleagues with accounts: a doctor and a nurse may take a handover; a bed manager and another hospital's doctor may not.
  await db.insert(user).values([["dr-aisyah", "Dr Aisyah"], ["dr-lim", "Dr Lim"], ["nurse-mei", "Nurse Mei"], ["beds-tan", "Tan (beds)"], ["dr-away", "Dr Away"]].map(([id, name]) => ({ id: id!, name: name!, email: `${id}@demo.test` })));
  await addClinician(db, "dr-lim");
  await addClinician(db, "nurse-mei", undefined, "nurse");
  await addClinician(db, "beds-tan", undefined, "bed-manager");
  await db.insert(hospitals).values({ id: "elsewhere", name: "Elsewhere" });
  await addClinician(db, "dr-away", "elsewhere");
  return createRouterClient(appRouter, { context: { db, session: signed ? session : null, now: () => new Date("2026-09-26T10:00:00+08:00"), ...extra } });
}

test("the handover is one SBAR card per patient built from the server's rows, patients to watch first", async () => {
  const api = await signedIn();
  const cards = await api.handover.list();
  expect(cards.map(c => [c.id, c.name, c.priority])).toEqual([
    ["visit-SYN-1086", "Daniel Rahman", "watch"], ["visit-SYN-1042", "Amelia Tan", "stable"],
    // The rest of the ward; a result still pending at the lab (Nurul's culture, Ravi's renal function) is nothing to act on yet.
    ["visit-SYN-2002", "Nurul Huda", "stable"], ["visit-SYN-2014", "Lim Wei Jie", "stable"], ["visit-SYN-2008", "Priya Nair", "stable"],
    ["visit-SYN-2012", "Siti Aminah", "stable"], ["visit-SYN-2009", "Ravi Kumar", "stable"], ["visit-SYN-2004", "Tan Ah Kow", "stable"],
    // The seed's WARD_EXTRA beds; Harjit's repeat haemoglobin is pending too.
    ["visit-SYN-2007", "Dayang Suhaila", "stable"], ["visit-SYN-2001", "Hafizah Yusof", "stable"], ["visit-SYN-2005", "Suresh Pillai", "stable"], ["visit-SYN-2013", "Wong Siew Ling", "stable"], ["visit-SYN-2017", "Harjit Singh", "stable"],
    ["visit-SYN-2011", "Ganesan Muthu", "stable"], ["visit-SYN-2016", "Rosnah Ismail", "stable"], ["visit-SYN-2003", "Chong Mei Yee", "stable"], ["visit-SYN-2015", "Jimmy Anak Sali", "stable"],
  ]);
  expect(cards.flatMap(c => c.recommendation).filter(l => l.startsWith("Act on pending"))).toEqual([]);
  const [daniel, amelia] = cards;
  expect(daniel!.meta).toBe("Clinic 09:45 · 57 · Male");
  expect(daniel!.recommendation).toContain("Complete onset, observations, allergies and medicines");
  expect(daniel!.recommendation.some(line => line.startsWith("Act on low potassium (3.1 mmol/L)"))).toBe(true);
  expect(amelia!.background).toBe("Allergy: Penicillin.");
  expect(amelia!.assessment).toContain("Respiratory rate 18 /min");
});

test("a discharged patient is not handed over, unless a result of theirs still waits; a result from another day carries its date", async () => {
  const db = await createTestDb();
  // The next morning on the hospital's clock: Daniel's potassium came in the day before.
  const api = await signedIn({ db, now: () => new Date("2026-09-27T08:00:00+08:00") });
  const discharge = async (patientId: string) => {
    const [visit] = await db.select().from(encounters).where(eq(encounters.patientId, patientId));
    await db.update(encounters).set({ state: { ...visit!.state, discharge: { dischargedAt: "2026-09-26T12:00:00+08:00" } } as typeof visit.state }).where(eq(encounters.id, visit!.id));
  };
  await discharge("SYN-1042");
  await discharge("SYN-1086");
  const cards = await api.handover.list();
  expect(cards).toHaveLength(16);
  expect(cards.some(c => c.id === "visit-SYN-1042")).toBe(false);
  // Daniel went home with a low potassium nobody acknowledged: he stays, first, and the line says which day it came in.
  expect(cards[0]!.id).toBe("visit-SYN-1086");
  expect(cards[0]!.recommendation.find(l => l.startsWith("Act on low potassium"))).toMatch(/received \d\d:\d\d on 26 Sep$/);
  // A card that is no longer built cannot be accepted.
  expect((await api.handover.accept({ requestId: "hand-gone", cardIds: ["visit-SYN-1042"], toUser: "dr-lim" }).catch(e => e)).code).toBe("NOT_FOUND");
});

test("accepting the handover writes one acceptance however often the request is replayed, and refuses cards it never built", async () => {
  const api = await signedIn();
  const accept = { requestId: "hand-1", cardIds: ["visit-SYN-1086", "visit-SYN-1042"], toUser: "dr-lim" };
  const first = await api.handover.accept(accept);
  expect(first).toMatchObject({ fromUser: "dr-aisyah", ...accept });
  expect(await api.handover.accept(accept)).toEqual(first);
  const unknown = await api.handover.accept({ ...accept, requestId: "hand-2", cardIds: ["ward-12"] }).catch(e => e);
  expect(unknown.code).toBe("NOT_FOUND");
});

test("the receiver is picked from the hospital's own doctors and nurses, and an acceptance names one of them by id", async () => {
  const api = await signedIn();
  expect(await api.handover.receivers()).toEqual([{ id: "dr-lim", name: "Dr Lim", role: "doctor" }, { id: "nurse-mei", name: "Nurse Mei", role: "nurse" }]);
  const accept = { requestId: "hand-3", cardIds: ["visit-SYN-1086"] };
  // A typed name, a role that may not accept, another hospital's doctor and the outgoing clinician are all refused.
  for (const toUser of ["Dr Lim · night registrar", "beds-tan", "dr-away", "dr-aisyah"]) expect((await api.handover.accept({ ...accept, toUser }).catch(e => e)).code).toBe("BAD_REQUEST");
  expect(await api.handover.accept({ ...accept, toUser: "nurse-mei" })).toMatchObject({ fromUser: "dr-aisyah", toUser: "nurse-mei" });
});

/** An in-memory stand-in for the Worker's R2 bucket. */
function memoryBucket() {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  return {
    objects,
    put: async (key: string, bytes: Uint8Array, options?: { httpMetadata?: { contentType?: string } }) => { objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType }); },
    get: async (key: string) => {
      const o = objects.get(key);
      return o ? { arrayBuffer: async () => o.bytes.slice().buffer, httpMetadata: { contentType: o.contentType } } : null;
    },
  };
}
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64");

test("an X-ray is stored under the hospital's own key, and anything that is not an image is refused", async () => {
  const uploads = memoryBucket();
  const api = await signedIn({ uploads });
  const { key } = await api.xray.upload({ encounterId: "visit-1042", contentType: "image/png", dataBase64: png });
  expect(key.startsWith("demo/xray/visit-1042/")).toBe(true);
  expect(uploads.objects.get(key)).toEqual({ bytes: new Uint8Array(Buffer.from(png, "base64")), contentType: "image/png" });
  const pdf = await api.xray.upload({ encounterId: "visit-1042", contentType: "application/pdf", dataBase64: png }).catch(e => e);
  expect(pdf.code).toBe("BAD_REQUEST");
  const elsewhere = await api.xray.upload({ encounterId: "visit-404", contentType: "image/png", dataBase64: png }).catch(e => e);
  expect(elsewhere.code).toBe("NOT_FOUND");
  expect(uploads.objects.size).toBe(1);
});

test("reading an X-ray hands the latest image to the model seam and labels the answer unvalidated", async () => {
  const seen: { image: number[]; contentType: string }[] = [];
  const models = { ...stubModels, xrayRead: async ({ image, contentType }: { image: Uint8Array; contentType: string }) => {
    seen.push({ image: [...image], contentType });
    return { findings: ["Fake model: right lower zone opacity"], validated: false as const, source: "model" as const, model: "fake-xray-1" };
  } };
  const api = await signedIn({ uploads: memoryBucket(), models });
  expect((await api.xray.read({ encounterId: "visit-1042" }).catch(e => e)).code).toBe("NOT_FOUND");
  await api.xray.upload({ encounterId: "visit-1042", contentType: "image/jpeg", dataBase64: Buffer.from([9]).toString("base64") });
  const { key } = await api.xray.upload({ encounterId: "visit-1042", contentType: "image/png", dataBase64: png });
  const read = await api.xray.read({ encounterId: "visit-1042" });
  expect(read).toEqual({ key, validated: false, findings: ["Fake model: right lower zone opacity"], source: "model", model: "fake-xray-1" });
  expect(seen).toEqual([{ image: [...Buffer.from(png, "base64")], contentType: "image/png" }]);
  // The model reads an image once: opened again, its stored reading comes back, still labelled with the model.
  expect(await api.xray.read({ encounterId: "visit-1042" })).toEqual({ ...read, storedAt: expect.any(Date) });
  expect(seen).toHaveLength(1);
});

test("without a model switched on, the X-ray read is the fixture's honest unavailable answer", async () => {
  const api = await signedIn({ uploads: memoryBucket() });
  await api.xray.upload({ encounterId: "visit-1086", contentType: "image/png", dataBase64: png });
  expect(await api.xray.read({ encounterId: "visit-1086" })).toMatchObject({ source: "fixture", validated: false });
});

test("the handover and X-ray routes need a signed-in user", async () => {
  const api = await signedIn({ uploads: memoryBucket() }, false);
  const calls = [() => api.handover.list(), () => api.handover.accept({ requestId: "r", cardIds: ["visit-SYN-1042"], toUser: "dr-lim" }),
    () => api.handover.receivers(),
    () => api.xray.upload({ encounterId: "visit-1042", contentType: "image/png", dataBase64: png }), () => api.xray.read({ encounterId: "visit-1042" })];
  for (const call of calls) expect((await call().catch(e => e)).code).toBe("UNAUTHORIZED");
});
