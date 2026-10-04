import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { encounters, guaranteeLetters, hospitals, provenance, trainingConsents, trainingSamples } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { SAMPLE_NOTE, appendSections, mergeMedicines, segments, unsureWords, scanDoneLine } from "@sona-ai/domain/scan";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { Context } from "../context";
import { stubModels, type Models } from "../models";
import { appRouter } from "./index";

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

function memoryBucket() {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  return { objects, put: async (key: string, bytes: Uint8Array, o?: { httpMetadata?: { contentType?: string } }) => { objects.set(key, { bytes, contentType: o?.httpMetadata?.contentType }); },
    get: async (key: string) => { const o = objects.get(key); return o ? { arrayBuffer: async () => o.bytes.slice().buffer, httpMetadata: { contentType: o.contentType } } : null; } };
}

async function world(extra: Partial<Context> = {}) {
  const db = await createTestDb();
  const now = new Date("2026-09-29T10:00:00+08:00");
  await seedDemo(db, new Date("2026-09-29T09:00:00+08:00"));
  await addClinician(db, "dr-aisyah");
  await addClinician(db, "nurse-mei", undefined, "nurse");
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), now: () => now, ...extra } });
  return { db, now, doctor: as("dr-aisyah"), nurse: as("nurse-mei"), as };
}
const codeOf = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code);
const ALL = { sections: SAMPLE_NOTE.sections, medicines: SAMPLE_NOTE.medicines, tasks: SAMPLE_NOTE.tasks, followUp: SAMPLE_NOTE.followUp };

test("the sample note reads as Amelia's ward round, honestly a fixture, with two words to check, and reading writes nothing to her record", async () => {
  const { db, doctor } = await world();
  const before = await doctor.encounter.get({ encounterId: "visit-1042" });
  const reading = await doctor.scan.read({ encounterId: "visit-1042", key: "sample" });
  expect(reading.source).toBe("fixture");
  expect(unsureWords(reading)).toEqual(["crepts", "BD"]);
  expect(reading.medicines).toEqual([{ name: "Clarithromycin", dose: "500 mg oral", frequency: "BD", change: "changed", confidence: "low" }]);
  expect(reading.tasks).toEqual([{ title: "Repeat chest X-ray and FBC", due: "Tomorrow", owner: "Ward nurse" }]);
  expect(reading.followUp).toEqual({ in: "2 weeks" });
  expect(reading.text).toContain("Amelia T.");
  // Nothing changed: same revision, no note, no tasks; only the reading's provenance.
  expect((await doctor.encounter.get({ encounterId: "visit-1042" })).revision).toBe(before.revision);
  expect((await doctor.note.get({ encounterId: "visit-1042" })).revision).toBe(0);
  expect((await doctor.tasks.list()).filter(t => t.encounterId === "visit-1042" && t.kind === "followup")).toEqual([]);
  const [row] = await db.select().from(provenance).where(eq(provenance.id, "scan-read:visit-1042:sample"));
  expect(row).toMatchObject({ kind: "scan-read", model: "fixture", sourceIds: ["sample"] });
});

test("a photo is stored under the hospital's scans, the model reads its bytes, and the patient's name reaches it only de-identified", async () => {
  const seen: { image: number[]; name: string; meds: string[] }[] = [];
  const models: Models = { ...stubModels, readHandwrittenNote: async ({ image, patient }) => {
    seen.push({ image: [...image], name: patient.name, meds: patient.knownMedicines });
    return { ...structuredClone(SAMPLE_NOTE), source: "model", model: "gemma-4-vision-test" };
  } };
  const uploads = memoryBucket();
  const { doctor } = await world({ models, uploads });
  const { key } = await doctor.scan.upload({ encounterId: "visit-1042", contentType: "image/jpeg", dataBase64: Buffer.from([7, 8, 9]).toString("base64") });
  expect(key).toMatch(/^scans\/demo\/[0-9a-f-]+\.jpg$/);
  const reading = await doctor.scan.read({ encounterId: "visit-1042", key });
  // The stub's de-identifier is the rules; a PII model that read the name is named instead.
  expect(reading).toMatchObject({ source: "model", model: "gemma-4-vision-test", deidentifier: "rules" });
  expect(seen).toEqual([{ image: [7, 8, 9], name: "[NAME]", meds: ["Salbutamol inhaler, as needed", "Cetirizine tablet 10 mg, patient-reported"] }]);
  // The sample never goes to the model: it is the fixture's reading.
  expect(await doctor.scan.read({ encounterId: "visit-1042", key: "sample" })).toMatchObject({ source: "fixture", deidentifier: "none" });
  expect(seen).toHaveLength(1);
  // Another hospital's key, or a key outside scans, is not found.
  expect(await codeOf(doctor.scan.read({ encounterId: "visit-1042", key: "scans/other/x.jpg" }))).toBe("NOT_FOUND");
  expect(await codeOf(doctor.scan.read({ encounterId: "visit-1042", key: "demo/xray/visit-1042/x" }))).toBe("NOT_FOUND");
  const withPii = await world({ models: { ...models, deidentify: async () => ({ text: "[NAME]", replacements: [], source: "model", model: "pii-test" }) }, uploads });
  expect((await withPii.doctor.scan.read({ encounterId: "visit-1042", key })).deidentifier).toBe("pii-test");
});

test("applying appends only the kept sections, proposes the medicine unconfirmed, creates the tasks and records where it came from; a replay writes nothing again", async () => {
  const { db, doctor } = await world();
  await db.update(hospitals).set({ contributesTraining: true }).where(eq(hospitals.id, "demo"));
  await db.insert(trainingConsents).values({ hospitalId: "demo", patientId: "SYN-1042", consentedAt: new Date() });
  await doctor.note.save({ encounterId: "visit-1042", expectedRevision: 0, sentences: [{ id: "subjective", text: "Cough for five days." }, { id: "plan", text: "Chest X-ray." }] });
  await doctor.scan.read({ encounterId: "visit-1042", key: "sample" });
  const before = await doctor.encounter.get({ encounterId: "visit-1042" });

  const input = { encounterId: "visit-1042", key: "sample", requestId: "scan-1", ...ALL, sections: { examination: SAMPLE_NOTE.sections.examination, plan: SAMPLE_NOTE.sections.plan, history: "  " } };
  const applied = await doctor.scan.apply(input);
  expect(applied).toEqual({ noteRevision: 2, sections: 2, medicines: 1, tasks: 2, line: "Note updated · 1 medicine to confirm · 2 tasks added", sample: { deidentifier: "rules", status: "blocked" } });

  const note = await doctor.note.get({ encounterId: "visit-1042" });
  expect(note.sentences).toEqual([
    { id: "subjective", text: "Cough for five days." },
    { id: "objective", text: SAMPLE_NOTE.sections.examination },
    { id: "plan", text: `Chest X-ray.\n${SAMPLE_NOTE.sections.plan}` },
  ]);

  const after = await doctor.encounter.get({ encounterId: "visit-1042" });
  expect(after.revision).toBe(before.revision + 1);
  expect(after.state.medicationEntries?.map(m => [m.name, m.confirmed, m.change ?? null])).toEqual([
    ["Salbutamol inhaler, as needed", false, null], ["Cetirizine tablet 10 mg, patient-reported", false, null], ["Clarithromycin 500 mg oral BD", false, "changed"],
  ]);
  expect(after.state.medicationEntries?.[2]?.from).toBe("From a scanned handwritten note (sample)");

  const made = (await doctor.tasks.list()).filter(t => t.id.startsWith("scan:"));
  expect(made.map(t => [t.title, t.owner, t.due, t.kind])).toEqual([["Repeat chest X-ray and FBC", "Ward nurse", "Tomorrow", "followup"], ["Book follow-up in 2 weeks", "Attending doctor", "2 weeks", "followup"]]);
  const [receipt] = await db.select().from(provenance).where(eq(provenance.id, "scan-apply:visit-1042:scan-1"));
  expect(receipt).toMatchObject({ kind: "scan-apply", sourceIds: ["sample"], approvedBy: "dr-aisyah", model: "fixture" });

  // The same request again: the first result, and nothing appended or created twice.
  // Who de-identified the training sample is said once, when it is captured.
  const { sample: _, ...first } = applied;
  expect(await doctor.scan.apply(input)).toEqual(first);
  expect((await doctor.note.get({ encounterId: "visit-1042" })).revision).toBe(2);
  expect((await doctor.tasks.list()).filter(t => t.id.startsWith("scan:"))).toHaveLength(2);
  expect((await doctor.encounter.get({ encounterId: "visit-1042" })).revision).toBe(after.revision);
  // What the model read and what the doctor kept became a training sample (the leak gate catches "Amelia T.").
  const [sample] = await db.select().from(trainingSamples).where(eq(trainingSamples.id, "handwritten-scan:visit-1042:sample"));
  expect(sample).toMatchObject({ source: "handwritten-scan", sourceRef: "sample", status: "blocked" });
  expect((await doctor.accessLog.list({ patientId: "SYN-1042" })).lines.map(l => l.did)).toContain("added a scanned note to the record");
});

test("only doctors scan; nothing is written for items left out", async () => {
  const { nurse, doctor } = await world();
  expect(await codeOf(nurse.scan.read({ encounterId: "visit-1042", key: "sample" }))).toBe("FORBIDDEN");
  expect(await codeOf(nurse.scan.apply({ encounterId: "visit-1042", key: "sample", requestId: "n1" }))).toBe("FORBIDDEN");
  const before = await doctor.encounter.get({ encounterId: "visit-1042" });
  expect(await doctor.scan.apply({ encounterId: "visit-1042", key: "sample", requestId: "empty", medicines: [{ name: "Salbutamol", change: "continue", confidence: "high" }] }))
    .toEqual({ sections: 0, medicines: 0, tasks: 0, line: "Nothing added" });
  expect((await doctor.encounter.get({ encounterId: "visit-1042" })).revision).toBe(before.revision);
  expect((await doctor.note.get({ encounterId: "visit-1042" })).revision).toBe(0);
});

test("Sona Care reads a medicine photo as a proposal and keeps the photo under the patient's own prefix", async () => {
  const uploads = memoryBucket();
  const { db, doctor, as } = await world({ uploads });
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: new Date() }).where(eq(guaranteeLetters.id, "gl-1042"));
  await db.update(encounters).set({ state: { discharge: { glReceived: true, medsConfirmed: true, followUp: "2w", language: "ms" } } }).where(eq(encounters.id, "visit-1042"));
  const amelia = as("amelia-account");
  await amelia.care.join({ code: (await doctor.care.code({ encounterId: "visit-1042" })).code });
  expect(await amelia.care.readMedicinePhoto({})).toEqual({ name: "Cetirizine", dose: "10 mg", frequency: "once at night", source: "fixture", key: undefined });
  const read = await amelia.care.readMedicinePhoto({ photo: { contentType: "image/jpeg", dataBase64: Buffer.from([1, 2]).toString("base64") } });
  expect(read.key).toMatch(/^care-photos\/demo\/SYN-1042\/[0-9a-f-]+\.jpg$/);
  expect([...uploads.objects.get(read.key!)!.bytes]).toEqual([1, 2]);
});

test("the merge rules: sections append, medicine changes replace or add unconfirmed, unsure words split out", () => {
  const empty = { subjective: "", objective: "", assessment: "", plan: "" };
  expect(appendSections({ ...empty, plan: "Mine." }, { plan: "Scanned.", history: "" })).toEqual({ ...empty, plan: "Mine.\nScanned." });
  const entries = [{ id: "m0", name: "Salbutamol inhaler", ingredient: "salbutamol", formulation: "inhaler", confirmed: true }];
  expect(mergeMedicines(entries, [{ name: "Salbutamol", dose: "2 puffs", change: "stopped", confidence: "high" }, { name: "Prednisolone", dose: "30 mg", change: "new", confidence: "high" }], "scan"))
    .toEqual([
      { id: "m0", name: "Salbutamol 2 puffs", ingredient: "salbutamol", formulation: "inhaler", confirmed: false, change: "stopped", from: "scan" },
      { id: "scan-prednisolone", name: "Prednisolone 30 mg", ingredient: "prednisolone", formulation: "tablet", confirmed: false, change: "new", from: "scan" },
    ]);
  expect(segments("Few crepts at the right base.", ["crepts", "BD"])).toEqual([{ text: "Few ", unsure: false }, { text: "crepts", unsure: true }, { text: " at the right base.", unsure: false }]);
  expect(scanDoneLine({ sections: 4, medicines: 1, tasks: 1 })).toBe("Note updated · 1 medicine to confirm · 1 task added");
});
