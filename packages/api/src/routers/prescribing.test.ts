import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";

import { appRouter } from "./index";

const session = {
  user: { id: "dr-aisyah", name: "Dr Aisyah", email: "aisyah@demo.test", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: "s1", userId: "dr-aisyah", token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session;

async function signedIn(signed = true) {
  const db = await createTestDb();
  await seedDemo(db);
  await addClinician(db, "dr-aisyah");
  return createRouterClient(appRouter, { context: { db, session: signed ? session : null, now: () => new Date("2026-09-26T10:00:00+08:00") } });
}
const code = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e.code);

const eligible = { weightKg: "62", liverDisease: "no", kidneyDisease: "no", alcoholRisk: "no", paracetamolAllergy: "no" } as const;
const confirmed = [
  { id: "m0", name: "Salbutamol inhaler", ingredient: "salbutamol", formulation: "inhaler", confirmed: true },
  { id: "m1", name: "Cetirizine", ingredient: "cetirizine", formulation: "tablet", confirmed: true },
];

test("the medication review is recorded at the revision it ran against; a stale revision is refused", async () => {
  const api = await signedIn();
  const edited = await api.encounter.edit({ encounterId: "visit-1042", expectedRevision: 1, prescriptionInputs: eligible });
  expect(await code(api.prescribing.review({ encounterId: "visit-1042", expectedRevision: 1 }))).toBe("CONFLICT");
  const reviewed = await api.prescribing.review({ encounterId: "visit-1042", expectedRevision: edited.revision });
  expect([reviewed.revision, reviewed.state.medicationCheckedRevision, reviewed.state.reviewInvalidated]).toEqual([2, 2, false]);
});

const simulate = { encounterId: "visit-1042", requestId: "rx-1", approvedBy: "dr-aisyah" };
const refusal = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; data?: { open?: string[] } }) => [e.code, e.data?.open]);

test("the prescription is refused while any check is blocked, and the refusal names the blocked checks", async () => {
  const api = await signedIn();
  expect(await refusal(api.prescribing.simulate(simulate))).toEqual(["PRECONDITION_FAILED",
    ["Medication identity", "Current medication review", "Adult age & weight", "Paracetamol allergy", "Liver history", "Kidney history", "Alcohol risk"]]);
});

test("with every check passed the prescription is receipted once per revision; an edit after the review blocks it again", async () => {
  const api = await signedIn();
  const edited = await api.encounter.edit({ encounterId: "visit-1042", expectedRevision: 1, prescriptionInputs: eligible, medicationEntries: confirmed });
  await api.prescribing.review({ encounterId: "visit-1042", expectedRevision: edited.revision });

  expect(await code(api.prescribing.simulate({ ...simulate, approvedBy: "dr-someone-else" }))).toBe("FORBIDDEN");
  const receipt = await api.prescribing.simulate(simulate);
  expect(receipt).toMatchObject({ kind: "prescription", ...simulate, revision: 2, payload: { medication: "Paracetamol", sourceId: "paracetamol-reference" } });
  expect(await api.prescribing.simulate(simulate)).toEqual(receipt);
  expect(await api.prescribing.simulate({ ...simulate, requestId: "rx-again" })).toEqual(receipt); // already prescribed at this revision

  await api.encounter.edit({ encounterId: "visit-1042", expectedRevision: 2, proposedMedicine: "Paracetamol" });
  expect(await refusal(api.prescribing.simulate({ ...simulate, requestId: "rx-2" }))).toEqual(["PRECONDITION_FAILED", ["Current medication review"]]);
});

test("a note save appends the next revision; a save against an older revision is refused and the latest stays", async () => {
  const api = await signedIn();
  expect(await api.note.get({ encounterId: "visit-1042" })).toEqual({ encounterId: "visit-1042", revision: 0, sentences: [] });
  const seeded = await api.note.get({ encounterId: "visit-1086" });
  expect([seeded.revision, seeded.sentences.map(s => s.id)]).toEqual([1, ["s1", "s2"]]);

  const sentences = [...seeded.sentences, { id: "s3", text: "Onset three weeks ago, per patient." }];
  const saved = await api.note.save({ encounterId: "visit-1086", sentences, expectedRevision: 1 });
  expect(saved).toEqual({ encounterId: "visit-1086", revision: 2, sentences });
  expect(await code(api.note.save({ encounterId: "visit-1086", sentences: seeded.sentences, expectedRevision: 1 }))).toBe("CONFLICT");
  expect(await api.note.get({ encounterId: "visit-1086" })).toEqual(saved);
  expect(await code(api.note.get({ encounterId: "visit-404" }))).toBe("NOT_FOUND");
});

test("prescribing and note routes need a signed-in user", async () => {
  const api = await signedIn(false);
  const codes = await Promise.all([api.prescribing.review({ encounterId: "visit-1042", expectedRevision: 1 }), api.prescribing.simulate(simulate),
    api.note.get({ encounterId: "visit-1042" }), api.note.save({ encounterId: "visit-1042", sentences: [], expectedRevision: 0 })].map(code));
  expect(codes).toEqual(["UNAUTHORIZED", "UNAUTHORIZED", "UNAUTHORIZED", "UNAUTHORIZED"]);
});
