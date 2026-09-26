import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { seedDemo } from "@sona-ai/db/seed";
import { createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";

import type { Context } from "../context";
import { stubModels } from "../models";
import { appRouter } from "./index";

const session = {
  user: { id: "dr-aisyah", name: "Dr Aisyah", email: "aisyah@demo.test", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: "s1", userId: "dr-aisyah", token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session;

async function signedIn(extra: Partial<Context> = {}, signed = true) {
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T09:00:00+08:00"));
  return createRouterClient(appRouter, { context: { db, session: signed ? session : null, now: () => new Date("2026-09-26T10:00:00+08:00"), ...extra } });
}

test("the handover is one SBAR card per patient built from the server's rows, patients to watch first", async () => {
  const api = await signedIn();
  const cards = await api.handover.list();
  expect(cards.map(c => [c.id, c.name, c.priority])).toEqual([["visit-SYN-1086", "Daniel Rahman", "watch"], ["visit-SYN-1042", "Amelia Tan", "stable"]]);
  const [daniel, amelia] = cards;
  expect(daniel!.meta).toBe("Clinic 09:45 · 57 · Male");
  expect(daniel!.recommendation).toContain("Complete onset, observations, allergies and medicines");
  expect(daniel!.recommendation.some(line => line.startsWith("Act on low potassium (3.1 mmol/L)"))).toBe(true);
  expect(amelia!.background).toBe("Allergy: Penicillin.");
  expect(amelia!.assessment).toContain("Respiratory rate 18 /min");
});

test("accepting the handover writes one acceptance however often the request is replayed, and refuses cards it never built", async () => {
  const api = await signedIn();
  const accept = { requestId: "hand-1", cardIds: ["visit-SYN-1086", "visit-SYN-1042"], toUser: "Dr Lim · night registrar" };
  const first = await api.handover.accept(accept);
  expect(first).toMatchObject({ fromUser: "dr-aisyah", ...accept });
  expect(await api.handover.accept(accept)).toEqual(first);
  const unknown = await api.handover.accept({ ...accept, requestId: "hand-2", cardIds: ["ward-12"] }).catch(e => e);
  expect(unknown.code).toBe("NOT_FOUND");
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
});

test("without a model switched on, the X-ray read is the fixture's honest unavailable answer", async () => {
  const api = await signedIn({ uploads: memoryBucket() });
  await api.xray.upload({ encounterId: "visit-1086", contentType: "image/png", dataBase64: png });
  expect(await api.xray.read({ encounterId: "visit-1086" })).toMatchObject({ source: "fixture", validated: false });
});

test("the handover and X-ray routes need a signed-in user", async () => {
  const api = await signedIn({ uploads: memoryBucket() }, false);
  const calls = [() => api.handover.list(), () => api.handover.accept({ requestId: "r", cardIds: ["visit-SYN-1042"], toUser: "Dr Lim" }),
    () => api.xray.upload({ encounterId: "visit-1042", contentType: "image/png", dataBase64: png }), () => api.xray.read({ encounterId: "visit-1042" })];
  for (const call of calls) expect((await call().catch(e => e)).code).toBe("UNAUTHORIZED");
});
