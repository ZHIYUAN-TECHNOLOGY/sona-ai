import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { visitSummaries } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";

import { stubModels, type Models } from "../models";
import { appRouter } from "./index";
import { checkSummary, followUpsOf } from "./review";

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

const now = new Date("2026-09-26T10:00:00+08:00");
const note = [{ id: "s1", text: "Chest infection, improving." }, { id: "s2", text: "Continue amoxicillin 500 mg for 5 days." }];

async function world(models?: Models) {
  const db = await createTestDb();
  await seedDemo(db, now);
  await addClinician(db, "dr-aisyah");
  await addClinician(db, "nurse-mei", undefined, "nurse");
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), now: () => now, models } });
  const doctor = as("dr-aisyah"), nurse = as("nurse-mei"), amelia = as("amelia-account");
  await amelia.care.join({ code: (await doctor.care.code({ encounterId: "visit-1042" })).code });
  const save = async (sentences = note) => doctor.note.save({ encounterId: "visit-1042", sentences, expectedRevision: (await doctor.note.get({ encounterId: "visit-1042" })).revision });
  return { db, doctor, nurse, amelia, save };
}

test("a doctor's saved note drafts one summary for review; the patient reads it only once approved, with the clinician's edit", async () => {
  const { doctor, nurse, amelia, save } = await world();
  await save();
  await save(); // a later save replaces the waiting draft
  const [item, ...rest] = await nurse.review.list();
  expect(rest).toEqual([]);
  expect(item).toMatchObject({ kind: "visit-summary", encounterId: "visit-1042", origin: "fixture", patient: { id: (await amelia.care.me()).patientId } });
  expect(item!.text).toContain("amoxicillin 500 mg");
  expect(item!.sources.slice(0, 2)).toEqual([{ n: 1, kind: "note", ref: "s1", text: note[0]!.text }, { n: 2, kind: "note", ref: "s2", text: note[1]!.text }]);
  expect(item!.checks.find(c => c.id === "doses")).toMatchObject({ ok: true });
  expect(await amelia.care.visitSummaries.list()).toEqual([]); // a draft is never visible to the patient

  await expect(nurse.review.approve({ id: item!.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  const edited = "Your chest infection is improving. Continue amoxicillin 500 mg for 5 days.";
  expect(await doctor.review.approve({ id: item!.id, text: edited })).toMatchObject({ status: "approved", text: edited });
  expect(await amelia.care.visitSummaries.list()).toEqual([{ id: item!.id, at: now, text: edited, whatChanged: item!.whatChanged }]);
  expect(await doctor.review.list()).toEqual([]);

  await save(); // a save after approval drafts anew and leaves the approved one alone
  const [next] = await doctor.review.list();
  expect(next!.id).not.toBe(item!.id);
  expect(await doctor.review.dismiss({ id: next!.id })).toEqual({ id: next!.id, status: "dismissed" });
  expect((await amelia.care.visitSummaries.list()).map(s => s.id)).toEqual([item!.id]);
});

test("another patient's or hospital's summary is never returned", async () => {
  const { db, doctor, amelia } = await world();
  const row = { text: "Theirs.", whatChanged: [], sources: [], checks: [], origin: "fixture" as const, encounterId: "visit-1042", createdAt: now, approvedAt: now };
  await db.insert(visitSummaries).values([
    { ...row, id: "vs-other-patient", hospitalId: "elsewhere", patientId: "SYN-1086", status: "approved" },
    { ...row, id: "vs-other-hospital", hospitalId: "elsewhere", patientId: "SYN-9999", status: "draft" },
  ]);
  expect(await amelia.care.visitSummaries.list()).toEqual([]);
  expect(await doctor.review.list()).toEqual([]);
  await expect(doctor.review.approve({ id: "vs-other-hospital" })).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("a failing check is reported: a medicine and a dose the visit never gave, and a sentence with no source", async () => {
  const { doctor, save } = await world({ ...stubModels, draftVisitSummary: async () => ({ text: "Take warfarin 7 mg daily. Drink plenty of water.", whatChanged: [], source: "model", model: "m" }) } as Models);
  await save();
  const [item] = await doctor.review.list();
  expect(item!.origin).toBe("model");
  expect(Object.fromEntries(item!.checks.map(c => [c.id, c.ok]))).toEqual({ medicines: false, doses: false, sources: false, length: true });
  expect(item!.checks.find(c => c.id === "medicines")!.detail).toBe("warfarin");
  expect(checkSummary("x".repeat(1300), { sections: [], prescriptions: [], followUps: [] }).find(c => c.id === "length")!.ok).toBe(false);
});

test("a summary's follow-ups skip the visit's own appointment today, read as a patient would, and fall back to the chosen review", () => {
  const now = new Date("2026-10-07T04:00:00Z"); // 12:00 in Malaysia
  const today = { kind: "Clinic visit", startsAt: new Date("2026-10-07T06:34:00Z") };
  const later = { kind: "Clinic review", startsAt: new Date("2026-10-12T01:00:00Z") };
  expect(followUpsOf([today, later], "1w", now)).toEqual(["Clinic review on Mon 12 Oct"]);
  expect(followUpsOf([today], "1w", now)).toEqual(["Clinic review in about 1 week"]);
  expect(followUpsOf([today], "2w", now)).toEqual(["Clinic review in about 2 weeks"]);
  expect(followUpsOf([today], undefined, now)).toEqual([]);
});
