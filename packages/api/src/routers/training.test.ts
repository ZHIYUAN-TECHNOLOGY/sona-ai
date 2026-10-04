import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { careLinks, trainingSamples } from "@sona-ai/db/schema/clinical";
import { DEMO_HOSPITAL, seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { BOXES, basetenModels, boxState } from "../baseten-models";
import type { Change } from "../events";
import { stubModels, type Models } from "../models";
import { PII_MODEL } from "../pii-model";
import { scheduleCheckIns } from "./check-ins";
import { appRouter } from "./index";

const session = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);
const codeOf = (p: Promise<unknown>) => p.then(() => "OK", (e: { data?: { code?: string }; code?: string }) => e.data?.code ?? e.code);

/** The demo hospital with a doctor, a manager, a nurse, Amelia's Sona Care account and her check-ins, and an in-memory bucket. */
async function world(models?: Models) {
  const db = await createTestDb();
  const now = new Date("2026-09-28T10:00:00+08:00");
  await seedDemo(db, now);
  for (const role of ["doctor", "nurse", "management"] as const) await addClinician(db, role, undefined, role);
  await db.insert(careLinks).values({ userId: "amelia", hospitalId: DEMO_HOSPITAL, patientId: "SYN-1042" });
  await scheduleCheckIns(db, DEMO_HOSPITAL, { id: "SYN-1042", name: "Amelia Tan" }, "visit-1042", "ms", now);
  const bucket = new Map<string, Uint8Array>();
  const uploads = { put: async (key: string, value: Uint8Array) => { bucket.set(key, value); }, get: async () => null };
  // Time moves a second per read, so "newest first" is well defined.
  let ticks = 0;
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: session(id), now: () => new Date(now.getTime() + ++ticks * 1000), uploads, models } });
  return { db, bucket, doctor: as("doctor"), nurse: as("nurse"), manager: as("management"), amelia: as("amelia") };
}
const saveNote = (doctor: Awaited<ReturnType<typeof world>>["doctor"], expectedRevision: number, text: string, excludeFromTraining?: boolean) =>
  doctor.note.save({ encounterId: "visit-1042", expectedRevision, sentences: [{ id: "subjective", text }], excludeFromTraining });

test("the stub de-identifier is labelled a fixture and replaces full names only", async () => {
  const out = await stubModels.deidentify({ text: "Amelia Tan, 011-0000 0000. Amelia is better.", known: { names: ["Amelia Tan"], phone: "+601100000000" } });
  expect(out).toEqual({ text: "[NAME], [PHONE]. Amelia is better.", replacements: [{ kind: "name", placeholder: "[NAME]" }, { kind: "phone", placeholder: "[PHONE]" }], source: "fixture" });
});

test("nothing is captured until the hospital contributes AND the patient consents; a withdrawal stops it again", async () => {
  const { db, doctor, manager, amelia } = await world();
  await saveNote(doctor, 0, "Cough five days.");
  await amelia.care.setTrainingConsent({ consented: true });
  await saveNote(doctor, 1, "Cough five days, fever.");
  expect(await db.select().from(trainingSamples)).toEqual([]); // consented, but the hospital does not contribute
  await manager.training.setContributes({ contributes: true });
  await amelia.care.setTrainingConsent({ consented: false });
  await saveNote(doctor, 2, "Cough five days, fever, asthma.");
  expect(await db.select().from(trainingSamples)).toEqual([]); // contributes, but she withdrew
  expect(await amelia.care.trainingConsent()).toEqual({ consented: false, at: expect.any(Date) });
});

test("the scribe's draft names Amelia by first name: the rules miss it, the gate blocks the sample; her check-in reply waits for review", async () => {
  const { doctor, manager, amelia } = await world();
  await manager.training.setContributes({ contributes: true });
  await amelia.care.setTrainingConsent({ consented: true });
  // The save itself says who de-identified the sample it became, and that the gate stopped it.
  expect(await saveNote(doctor, 0, "Amelia Tan (SYN-1042): cough for five days; fever since yesterday.")).toMatchObject({ revision: 1, sample: { deidentifier: "rules", status: "blocked" } });
  await amelia.care.checkIns.reply({ checkInId: "check-in:visit-1042:2", text: "demam balik" });
  const samples = await manager.training.samples();
  expect(samples.map(s => [s.source, s.status, s.leak])).toEqual([["check-in-reply", "pending", null], ["note-edit", "blocked", ["name"]]]);
  const note = samples.find(s => s.source === "note-edit")!;
  expect(note.input).toStartWith("[LEAK] reports a cough");
  expect(note.output).toBe("[NAME] ([MRN]): cough for five days; fever since yesterday.");
  expect(note.patientLabel).toBe("Patient in Bed 6");
  expect(note.deidentifier).toBe("rules");
  expect(JSON.stringify(samples)).not.toMatch(/Amelia|SYN-1042/);
  expect(samples[0]).toMatchObject({ input: "demam balik", output: "worse" });
  expect(await manager.training.status()).toEqual({ contributes: true, counts: { pending: 1, approved: 0, blocked: 1, excluded: 0, withdrawn: 0 }, ready: 0, lastDataset: null });
  // A blocked sample cannot be approved; it can be excluded. excludeFromTraining on a save keeps the note out too.
  expect(await codeOf(manager.training.decide({ id: note.id, decision: "approve" }))).toBe("SAMPLE_BLOCKED");
  expect((await manager.training.decide({ id: note.id, decision: "exclude" })).status).toBe("excluded");
});

test("with OpenMed on the PII box the same draft loses her first name too, so it passes the gate and waits for review", async () => {
  boxState.clear();
  // The box finds "Amelia" wherever the rules left it; every other box is down.
  const fetcher = (async (url: string, init: RequestInit) => {
    if (!url.includes(BOXES.pii)) return new Response("no", { status: 503 });
    if (url.endsWith("/health")) return new Response("ok");
    const { text } = JSON.parse(init.body as string) as { text: string };
    const at = text.indexOf("Amelia");
    return Response.json({ entities: at < 0 ? [] : [{ label: "first_name", start: at, end: at + 6, confidence: 0.99 }] });
  }) as typeof fetch;
  const { doctor, manager, amelia } = await world(basetenModels({ apiKey: "k", fetcher }));
  await manager.training.setContributes({ contributes: true });
  await amelia.care.setTrainingConsent({ consented: true });
  await saveNote(doctor, 0, "Amelia Tan (SYN-1042): cough for five days; fever since yesterday.");
  const [note] = await manager.training.samples();
  expect(note).toMatchObject({ source: "note-edit", status: "pending", leak: null, output: "[NAME] ([MRN]): cough for five days; fever since yesterday." });
  expect(note!.input).toStartWith("[NAME] reports a cough");
  expect(note!.deidentifier).toBe(PII_MODEL);
});

test("export writes approved samples as JSONL, stamps the version, and the next export starts after it", async () => {
  const { db, bucket, manager, amelia } = await world();
  expect(await codeOf(manager.training.export())).toBe("NOTHING_TO_EXPORT");
  await manager.training.setContributes({ contributes: true });
  await amelia.care.setTrainingConsent({ consented: true });
  await amelia.care.checkIns.reply({ checkInId: "check-in:visit-1042:2", text: "demam balik" });
  await amelia.care.checkIns.reply({ checkInId: "check-in:visit-1042:7", text: "Saya sihat, terima kasih" });
  const [second, first] = await manager.training.samples({ status: "pending" });
  await manager.training.decide({ id: first!.id, decision: "approve" });
  expect((await manager.training.status()).ready).toBe(1);
  expect(await manager.training.export()).toEqual({ version: 1, rows: 1, key: `training/${DEMO_HOSPITAL}/v1.jsonl` });
  expect(new TextDecoder().decode(bucket.get(`training/${DEMO_HOSPITAL}/v1.jsonl`))).toBe(`{"source":"check-in-reply","input":"demam balik","output":"worse"}\n`);
  expect(await codeOf(manager.training.decide({ id: first!.id, decision: "exclude" }))).toBe("SAMPLE_EXPORTED");
  expect((await manager.training.status()).ready).toBe(0);
  expect(await codeOf(manager.training.export())).toBe("NOTHING_TO_EXPORT");
  // An approved sample the gate now finds identity in aborts the whole export and is blocked.
  await manager.training.decide({ id: second!.id, decision: "approve" });
  await db.update(trainingSamples).set({ output: "fine, says amelia" }).where(eq(trainingSamples.id, second!.id));
  expect(await codeOf(manager.training.export())).toBe("LEAK_FOUND");
  expect((await manager.training.status()).counts).toMatchObject({ approved: 1, blocked: 1 });
  expect((await manager.training.status()).lastDataset).toMatchObject({ version: 1, rows: 1 });
});

test("withdrawing marks her samples not yet exported as withdrawn; exported ones stay in their dataset", async () => {
  const { manager, amelia } = await world();
  await manager.training.setContributes({ contributes: true });
  expect(await amelia.care.trainingConsent()).toEqual({ consented: false, at: null });
  expect(await amelia.care.setTrainingConsent({ consented: true })).toEqual({ consented: true, at: expect.any(Date) });
  await amelia.care.checkIns.reply({ checkInId: "check-in:visit-1042:2", text: "demam balik" });
  await manager.training.decide({ id: (await manager.training.samples())[0]!.id, decision: "approve" });
  await manager.training.export();
  await amelia.care.checkIns.reply({ checkInId: "check-in:visit-1042:7", text: "Saya sihat" });
  await amelia.care.setTrainingConsent({ consented: false });
  expect((await manager.training.samples()).map(s => s.status)).toEqual(["withdrawn", "approved"]);
  expect(await codeOf(manager.training.decide({ id: (await manager.training.samples())[0]!.id, decision: "approve" }))).toBe("SAMPLE_WITHDRAWN");
});

test("a patient's consent change is announced as a training change, so management's Training screen re-reads", async () => {
  const { db } = await world();
  const heard: Change[] = [];
  const amelia = createRouterClient(appRouter, { context: { db, session: session("amelia"), announce: async (_hospital, change) => { heard.push(change); } } });
  await amelia.care.setTrainingConsent({ consented: true });
  expect(heard).toEqual([{ topic: "training", patientId: "SYN-1042" }]);
});

test("only management sees or changes training data", async () => {
  const { doctor, nurse } = await world();
  for (const client of [doctor, nurse])
    for (const call of [client.training.status(), client.training.samples(), client.training.setContributes({ contributes: true }), client.training.export()])
      expect(await codeOf(call)).toBe("FORBIDDEN");
});
