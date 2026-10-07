import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { accessLogs, hospitalMembers, hospitals } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { Context } from "../context";
import { stubModels, type Models } from "../models";
import { recordFacts } from "./encounter";
import { appRouter } from "./index";

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
}) as unknown as Session;

/** An in-memory bucket, as findings.test.ts fakes R2. */
const fakeUploads = () => {
  const objects = new Map<string, Uint8Array>();
  return { put: async (key: string, bytes: Uint8Array) => { objects.set(key, bytes); }, get: async (key: string) => { const bytes = objects.get(key); return bytes ? { arrayBuffer: async () => bytes.slice().buffer } : null; } };
};

async function signedIn(extra: Partial<Context> = {}) {
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T09:00:00+08:00"));
  await addClinician(db, "dr-aisyah");
  await db.insert(hospitals).values({ id: "other", name: "Other Hospital (synthetic)" });
  await db.insert(hospitalMembers).values({ userId: "dr-other", hospitalId: "other" });
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), uploads: fakeUploads(), now: () => new Date("2026-10-03T10:00:00+08:00"), ...extra } });
  return { db, as, api: as("dr-aisyah") };
}

const png = Buffer.from([1, 2, 3]).toString("base64");

test("the record tells of each X-ray by its date, a model's reading and the findings on it; a fixture's reading is never a model's", async () => {
  const models: Models = { ...stubModels, xrayRead: async () => ({ findings: ["Right upper zone opacity", "Heart size at the upper limit"], validated: false, source: "model", model: "fake-cxr-1" }) };
  const { api, db } = await signedIn({ models });
  const facts = () => recordFacts(db, "demo", "SYN-1042").then(lines => lines.filter(l => l.startsWith("Chest X-ray")));
  expect(await facts()).toEqual([]);
  await api.xray.upload({ encounterId: "visit-1042", contentType: "image/png", dataBase64: png });
  expect(await facts()).toEqual(["Chest X-ray (3 Oct 2026): not yet read by a model"]);
  await api.xray.read({ encounterId: "visit-1042" });
  await api.findings.detect({ encounterId: "visit-1042" }); // the stub's authored findings: a demo reading
  expect(await facts()).toEqual([
    "Chest X-ray (3 Oct 2026): Right upper zone opacity; Heart size at the upper limit; findings: 9 mm nodule, right upper zone 9 mm, right upper zone (open, CT chest due 1 Jan 2027, demo reading); Borderline heart size, cardiac silhouette (open, Echocardiogram due 14 Nov 2026, demo reading)",
  ]);
  // Another hospital's record holds none of it.
  expect(await recordFacts(db, "other", "SYN-1042")).toEqual([]);
});

test("the stub's reading leaves the film unread by a model", async () => {
  const { api, db } = await signedIn();
  await api.xray.upload({ encounterId: "visit-1086", contentType: "image/png", dataBase64: png });
  await api.xray.read({ encounterId: "visit-1086" });
  expect((await recordFacts(db, "demo", "SYN-1086")).filter(l => l.startsWith("Chest X-ray"))).toEqual(["Chest X-ray (3 Oct 2026): not yet read by a model"]);
});

test("xray.image hands back the visit's latest film, logs the view, and refuses another hospital or a visit with none", async () => {
  const { api, as, db } = await signedIn();
  await expect(api.xray.image({ encounterId: "visit-1042" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  const { key } = await api.xray.upload({ encounterId: "visit-1042", contentType: "image/png", dataBase64: png });
  expect(await api.xray.image({ encounterId: "visit-1042" })).toEqual({ key, contentType: "image/png", dataBase64: png, uploadedAt: "2026-10-03T02:00:00.000Z" });
  await expect(as("dr-other").xray.image({ encounterId: "visit-1042" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect((await db.select({ route: accessLogs.route }).from(accessLogs).where(eq(accessLogs.route, "xray.image"))).length).toBe(1);
});

test("a library that cannot index the film never fails the upload, read or detection", async () => {
  const library = { search: async () => [], ingest: async () => { throw new Error("embedder down"); }, reindex: async () => 0 };
  const { api } = await signedIn({ library });
  await api.xray.upload({ encounterId: "visit-1042", contentType: "image/png", dataBase64: png });
  expect(await api.xray.read({ encounterId: "visit-1042" })).toMatchObject({ validated: false });
  expect(await api.findings.detect({ encounterId: "visit-1042" })).toHaveLength(2);
});
