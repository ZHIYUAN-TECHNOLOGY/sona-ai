import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { findings, guaranteeLetters } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { Context } from "../context";
import type { Change } from "../events";
import { stubModels, type Models } from "../models";
import { appRouter } from "./index";

const session = {
  user: { id: "dr-aisyah", name: "Dr Aisyah", email: "aisyah@demo.test", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: "s1", userId: "dr-aisyah", token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session;

async function signedIn(extra: Partial<Context> = {}, signed = true) {
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T09:00:00+08:00"));
  await addClinician(db, "dr-aisyah");
  const clock = { now: new Date("2026-09-26T10:00:00+08:00") };
  return { db, clock, api: createRouterClient(appRouter, { context: { db, session: signed ? session : null, now: () => clock.now, ...extra } }) };
}

test("detecting findings stores Amelia's two with their rules, unvalidated, and running it again changes nothing", async () => {
  const { api } = await signedIn();
  const found = await api.findings.detect({ encounterId: "visit-1042" });
  expect(found.map(f => [f.kind, f.label, f.riskBand, f.ruleId, f.status, f.source, f.validated])).toEqual([
    ["nodule", "9 mm nodule, right upper zone", "high", "nodule-over-8", "open", "fixture", false],
    ["cardiomegaly", "Borderline heart size", "intermediate", "cardiomegaly-borderline", "open", "fixture", false],
  ]);
  expect(found[0]).toMatchObject({ patientId: "SYN-1042", action: "CT chest at 3 months, PET-CT or tissue sampling", intervalDays: 90, location: { x: 0.34, y: 0.3, zone: "right upper zone" } });
  expect(found[0]!.dueAt).toEqual(new Date("2026-12-25T10:00:00+08:00"));
  const again = await api.findings.detect({ encounterId: "visit-1042" });
  expect(again.map(f => f.id)).toEqual(found.map(f => f.id));
  expect(await api.findings.list({})).toHaveLength(2);
  // Daniel's film shows nothing incidental in the stub.
  expect(await api.findings.status({ encounterId: "visit-1086" })).toBeNull();
  expect(await api.findings.detect({ encounterId: "visit-1086" })).toEqual([]);
  // No rows either way, so the status says who found none: here the stub, which read no image.
  expect(await api.findings.status({ encounterId: "visit-1086" })).toEqual({ source: "fixture", readAt: expect.any(Date), imageKey: null, found: 0 });
  expect(await api.findings.status({ encounterId: "visit-1042" })).toMatchObject({ source: "fixture", found: 2 });
});

test("a model that read the film and found nothing is told apart from one that never ran", async () => {
  let awake = false;
  const models: Models = { ...stubModels, incidentalFindings: async input => awake ? { findings: [], validated: false, source: "model", model: "fake-cxr-1" } : stubModels.incidentalFindings(input) };
  const objects = new Map<string, Uint8Array>();
  const uploads = { put: async (key: string, bytes: Uint8Array) => { objects.set(key, bytes); }, get: async (key: string) => { const bytes = objects.get(key); return bytes ? { arrayBuffer: async () => bytes.slice().buffer } : null; } };
  const { api } = await signedIn({ models, uploads });
  const { key } = await api.xray.upload({ encounterId: "visit-1086", contentType: "image/png", dataBase64: Buffer.from([1, 2, 3]).toString("base64") });
  expect(await api.findings.status({ encounterId: "visit-1086" })).toBeNull();
  expect(await api.findings.detect({ encounterId: "visit-1086" })).toEqual([]);
  expect(await api.findings.status({ encounterId: "visit-1086" })).toMatchObject({ source: "fixture", found: 0, imageKey: key });
  awake = true;
  expect(await api.findings.detect({ encounterId: "visit-1086" })).toEqual([]);
  expect(await api.findings.status({ encounterId: "visit-1086" })).toEqual({ source: "model", model: "fake-cxr-1", readAt: expect.any(Date), imageKey: key, found: 0 });
  // A new film has not been read yet, whoever read the last one.
  await api.xray.upload({ encounterId: "visit-1086", contentType: "image/png", dataBase64: Buffer.from([4]).toString("base64") });
  expect(await api.findings.status({ encounterId: "visit-1086" })).toBeNull();
});

test("detection hands the model the uploaded X-ray when there is one", async () => {
  const seen: { image?: number[]; contentType?: string }[] = [];
  const models: Models = { ...stubModels, incidentalFindings: async input => {
    seen.push({ image: input.image && [...input.image], contentType: input.contentType });
    return { findings: [{ kind: "effusion", label: "Small left effusion", location: { x: 0.7, y: 0.8, zone: "left base" } }], validated: false, source: "model", model: "fake-cxr-1" };
  } };
  const objects = new Map<string, Uint8Array>();
  const uploads = { put: async (key: string, bytes: Uint8Array) => { objects.set(key, bytes); }, get: async (key: string) => {
    const bytes = objects.get(key);
    return bytes ? { arrayBuffer: async () => bytes.slice().buffer } : null;
  } };
  const { api } = await signedIn({ models, uploads });
  await api.findings.detect({ encounterId: "visit-1042" });
  await api.xray.upload({ encounterId: "visit-1042", contentType: "image/png", dataBase64: Buffer.from([1, 2, 3]).toString("base64") });
  const [finding] = await api.findings.detect({ encounterId: "visit-1042" });
  expect(seen).toEqual([{ image: undefined, contentType: undefined }, { image: [1, 2, 3], contentType: "image/png" }]);
  expect(finding).toMatchObject({ kind: "effusion", source: "fake-cxr-1", ruleId: "effusion-small", intervalDays: 14, validated: false });
  // Detected again on the same image, the model's stored reading is reused rather than paid for twice.
  expect((await api.findings.detect({ encounterId: "visit-1042" }))[0]).toMatchObject({ kind: "effusion", source: "fake-cxr-1" });
  expect(seen).toHaveLength(2);
});

test("tracking a finding tells the patient's Sona Care about the new recall", async () => {
  const heard: Change[] = [];
  const { api } = await signedIn({ announce: async (_hospital, change) => { heard.push(change); } });
  const [nodule] = await api.findings.detect({ encounterId: "visit-1042" });
  await api.findings.track({ findingId: nodule!.id, requestId: "t-1" });
  expect(heard).toContainEqual({ topic: "findings", patientId: "SYN-1042" });
});

test("a mark belongs to the image it was read from: the authored fixture claims no upload, a model's read carries that image's key", async () => {
  const objects = new Map<string, Uint8Array>();
  const uploads = { put: async (key: string, bytes: Uint8Array) => { objects.set(key, bytes); }, get: async (key: string) => {
    const bytes = objects.get(key);
    return bytes ? { arrayBuffer: async () => bytes.slice().buffer } : null;
  } };
  let eyes = false; // the image model is off, then on
  const models: Models = { ...stubModels, incidentalFindings: input => eyes
    ? Promise.resolve({ findings: [{ kind: "nodule", label: "12 mm nodule, left upper zone", sizeMm: 12, location: { x: 0.7, y: 0.25, zone: "left upper zone", box: [0.2, 0.65, 0.3, 0.75] } }], validated: false, source: "model", model: "medgemma-1.5-4b" })
    : stubModels.incidentalFindings(input) };
  const { api } = await signedIn({ models, uploads });
  const { key: first } = await api.xray.upload({ encounterId: "visit-1042", contentType: "image/png", dataBase64: Buffer.from([1]).toString("base64") });
  // The stub has no eyes: Amelia's authored findings were not read from her upload, so they carry no key.
  expect((await api.findings.detect({ encounterId: "visit-1042" })).map(f => [f.kind, f.source, f.imageKey])).toEqual([["nodule", "fixture", null], ["cardiomegaly", "fixture", null]]);
  eyes = true;
  expect((await api.findings.detect({ encounterId: "visit-1042" })).map(f => [f.kind, f.source, f.imageKey, f.label])).toEqual([["nodule", "medgemma-1.5-4b", first, "12 mm nodule, left upper zone"]]);
  // A read of a newer image moves the mark onto it.
  const { key: second } = await api.xray.upload({ encounterId: "visit-1042", contentType: "image/png", dataBase64: Buffer.from([2]).toString("base64") });
  expect((await api.findings.detect({ encounterId: "visit-1042" }))[0]?.imageKey).toBe(second);
});

test("tracking a finding makes one task and one recall at its due date, however often it is sent, and it turns overdue once the date passes", async () => {
  const { api, clock } = await signedIn();
  const [nodule] = await api.findings.detect({ encounterId: "visit-1042" });
  const tracked = await api.findings.track({ findingId: nodule!.id, requestId: "track-1" });
  expect(tracked).toMatchObject({ status: "tracked", owner: "Attending doctor", dueAt: new Date("2026-12-25T10:00:00+08:00"), overdue: false });
  expect(await api.findings.track({ findingId: nodule!.id, requestId: "track-1" })).toEqual(tracked);
  expect(await api.findings.track({ findingId: nodule!.id, requestId: "track-2", owner: "Someone else" })).toEqual(tracked);
  const followUps = (await api.tasks.list()).filter(t => t.kind === "finding");
  expect(followUps.map(t => [t.id, t.title, t.owner, t.due, t.encounterId])).toEqual([[tracked.taskId, "Follow up 9 mm nodule: CT chest at 3 months", "Attending doctor", "2026-12-25", "visit-1042"]]);
  expect((await api.day.list({ date: "2026-12-25" })).map(a => [a.patientName, a.kind])).toEqual([["Amelia Tan", "recall: CT chest"]]);
  clock.now = new Date("2026-12-26T09:00:00+08:00");
  expect((await api.findings.list({ encounterId: "visit-1042" })).map(f => [f.kind, f.status, f.overdue])).toEqual([["nodule", "tracked", true], ["cardiomegaly", "open", false]]);
});

test("a finding that needs no routine follow-up cannot be tracked, and an unknown one is not found", async () => {
  const models: Models = { ...stubModels, incidentalFindings: async () => ({ findings: [{ kind: "nodule", label: "4 mm nodule, left mid zone", sizeMm: 4, location: { x: 0.6, y: 0.5, zone: "left mid zone" } }], validated: false, source: "fixture" }) };
  const { api } = await signedIn({ models });
  const [small] = await api.findings.detect({ encounterId: "visit-1042" });
  expect(small).toMatchObject({ riskBand: "low", intervalDays: null, dueAt: null });
  const refusal = await api.findings.track({ findingId: small!.id, requestId: "t-small" }).catch(e => e);
  expect([refusal.code, refusal.message]).toEqual(["PRECONDITION_FAILED", "No routine follow-up needed"]);
  expect((await api.findings.track({ findingId: "finding:nowhere", requestId: "t-x" }).catch(e => e)).code).toBe("NOT_FOUND");
  expect(await api.tasks.list()).toEqual([]);
});

test("dismissing a finding keeps it on record as dismissed, and it is never overdue", async () => {
  const { api } = await signedIn();
  const [, heart] = await api.findings.detect({ encounterId: "visit-1042" });
  expect(await api.findings.dismiss({ findingId: heart!.id, reason: "Known, echo done last month" })).toMatchObject({ id: heart!.id, status: "dismissed", overdue: false });
  expect((await api.findings.list({})).map(f => f.status)).toEqual(["open", "dismissed"]);
  expect((await api.findings.dismiss({ findingId: "finding:nowhere", reason: "x" }).catch(e => e)).code).toBe("NOT_FOUND");
});

test("an open finding blocks discharge and shows on the bed and in handover until it is tracked or dismissed", async () => {
  const { api, db } = await signedIn();
  // Every other blocker cleared: the insurer's letter arrived, medicines confirmed, clinic review booked.
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: new Date() }).where(eq(guaranteeLetters.id, "gl-1042"));
  await api.discharge.update({ encounterId: "visit-1042", medsConfirmed: true, followUp: "2w" });
  const [nodule, heart] = await api.findings.detect({ encounterId: "visit-1042" });
  const discharge = { encounterId: "visit-1042", requestId: "d-1", approvedBy: "dr-aisyah" };
  const refusal = await api.discharge.request(discharge).catch(e => e);
  expect(refusal.code).toBe("PRECONDITION_FAILED");
  expect(refusal.data.blockers.map((b: { label: string; detail: string }) => [b.label, b.detail])).toEqual([
    ["9 mm nodule, right upper zone", "CT chest at 3 months, PET-CT or tissue sampling · due 25 Dec"],
    ["Borderline heart size", "Echocardiogram · due 7 Nov"],
  ]);
  const bed = (await api.ward.beds()).find(b => b.admissionId === "adm-1042")!;
  expect(bed.blockers.map(b => [b.kind, b.label])).toEqual([["result", "9 mm nodule, right upper zone"], ["result", "Borderline heart size"]]);
  const amelia = () => api.handover.list().then(cards => cards.find(c => c.patientId === "SYN-1042")!.recommendation.filter(l => l.startsWith("Follow up")));
  expect(await amelia()).toEqual(["Follow up 9 mm nodule: CT chest at 3 months · due 25 Dec", "Follow up borderline heart size: Echocardiogram · due 7 Nov"]);

  await api.findings.track({ findingId: nodule!.id, requestId: "t-1" });
  await api.findings.dismiss({ findingId: heart!.id, reason: "Known, echo done last month" });
  // Tracked, the nodule stays in handover once (not again as its task); dismissed, the heart size leaves it.
  expect(await amelia()).toEqual(["Follow up 9 mm nodule: CT chest at 3 months · due 25 Dec"]);
  expect((await api.ward.beds()).find(b => b.admissionId === "adm-1042")!.blockers).toEqual([]);
  expect(await api.discharge.request(discharge)).toMatchObject({ kind: "discharge" });
});

test("every findings route needs a signed-in doctor", async () => {
  const { api } = await signedIn({}, false);
  for (const call of [() => api.findings.detect({ encounterId: "visit-1042" }), () => api.findings.list({}), () => api.findings.track({ findingId: "f", requestId: "r" }), () => api.findings.dismiss({ findingId: "f", reason: "r" })])
    expect((await call().catch(e => e)).code).toBe("UNAUTHORIZED");
});

test("a new read refreshes where a finding is marked, but never its status, due date or rule once tracked", async () => {
  const { api, db, clock } = await signedIn();
  const [nodule] = await api.findings.detect({ encounterId: "visit-1042" });
  await db.update(findings).set({ location: { x: 0.34, y: 0.3, zone: "right upper zone" } }).where(eq(findings.id, nodule!.id)); // read before boxes existed
  await api.findings.track({ findingId: nodule!.id, requestId: "track-1" });
  clock.now = new Date("2026-09-27T10:00:00+08:00");
  const [again] = await api.findings.detect({ encounterId: "visit-1042" });
  expect(again).toMatchObject({ status: "tracked", location: { box: [0.26, 0.29, 0.34, 0.39] } });
  expect(again!.dueAt).toEqual(nodule!.dueAt);
});
