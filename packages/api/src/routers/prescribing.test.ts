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

// What the doctor entered for this patient (the app sends it as the visit's one proposed line).
const regimen = "Paracetamol 500 mg tablet · 1000 mg · Oral · Every 6 hours · 3 days";
const simulate = { encounterId: "visit-1042", requestId: "rx-1", approvedBy: "dr-aisyah" };
const refusal = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; data?: { open?: string[] } }) => [e.code, e.data?.open]);

test("the prescription is refused while any check is blocked, and the refusal names the blocked checks", async () => {
  const api = await signedIn();
  expect(await refusal(api.prescribing.simulate(simulate))).toEqual(["PRECONDITION_FAILED",
    ["Bounded regimen", "Medication identity", "Current medication review", "Adult age & weight", "Paracetamol allergy", "Liver history", "Kidney history", "Alcohol risk"]]);
});

test("with every check passed the prescription is receipted once per revision, with the regimen the doctor entered; an edit after the review blocks it again", async () => {
  const api = await signedIn();
  const edited = await api.encounter.edit({ encounterId: "visit-1042", expectedRevision: 1, prescriptionInputs: eligible, medicationEntries: confirmed, proposedMedicine: regimen });
  await api.prescribing.review({ encounterId: "visit-1042", expectedRevision: edited.revision });

  expect(await code(api.prescribing.simulate({ ...simulate, approvedBy: "dr-someone-else" }))).toBe("FORBIDDEN");
  const receipt = await api.prescribing.simulate(simulate);
  expect(receipt).toMatchObject({ kind: "prescription", ...simulate, approvedByName: "Dr Aisyah", revision: 2, payload: {
    medication: "Paracetamol", formulation: "500 mg tablet", dose: "1000", unit: "mg", route: "Oral", frequency: "Every 6 hours", duration: "3 days",
    indication: "Recorded complaint: Cough for five days, with fever since yesterday.", sourceId: "paracetamol-reference", transmitted: false, dispensed: false } });
  expect(receipt.payload).not.toHaveProperty("simulated");
  expect(await api.prescribing.simulate(simulate)).toEqual(receipt);
  expect(await api.prescribing.simulate({ ...simulate, requestId: "rx-again" })).toEqual(receipt); // already prescribed at this revision

  // A changed regimen is a new revision: it must be reviewed again, and its receipt carries the new dose, not the first one.
  const changed = await api.encounter.edit({ encounterId: "visit-1042", expectedRevision: 2, proposedMedicine: "Paracetamol 500 mg tablet · 500 mg · Oral · Every 8 hours · 2 days" });
  expect(await refusal(api.prescribing.simulate({ ...simulate, requestId: "rx-2" }))).toEqual(["PRECONDITION_FAILED", ["Current medication review"]]);
  await api.prescribing.review({ encounterId: "visit-1042", expectedRevision: changed.revision });
  expect((await api.prescribing.simulate({ ...simulate, requestId: "rx-2" })).payload).toMatchObject({ dose: "500", frequency: "Every 8 hours", duration: "2 days" });
});

test("no regimen, a bare medicine name, a dose over the limit or another medicine is refused: nothing is filled in for the doctor", async () => {
  const api = await signedIn();
  let revision = 1;
  for (const proposedMedicine of [undefined, "Paracetamol", "Paracetamol 500 mg tablet · 1000 mg · Oral · Every 4 hours · 3 days", "Ibuprofen 400 mg tablet · 400 mg · Oral · Every 8 hours · 3 days"]) {
    ({ revision } = await api.encounter.edit({ encounterId: "visit-1042", expectedRevision: revision, prescriptionInputs: eligible, medicationEntries: confirmed, proposedMedicine }));
    await api.prescribing.review({ encounterId: "visit-1042", expectedRevision: revision });
    expect(await refusal(api.prescribing.simulate(simulate))).toEqual(["PRECONDITION_FAILED", ["Bounded regimen"]]);
  }
});

test("the checks run on the server's record of the visit: its medicines, and an allergy the doctor recorded there", async () => {
  const api = await signedIn();
  // Propranolol on the visit is outside what the interaction rules cover, whatever the app shows.
  const propranolol = [...confirmed, { id: "m2", name: "Propranolol", ingredient: "propranolol", formulation: "tablet", confirmed: true }];
  let { revision } = await api.encounter.edit({ encounterId: "visit-1042", expectedRevision: 1, prescriptionInputs: eligible, medicationEntries: propranolol, proposedMedicine: regimen });
  await api.prescribing.review({ encounterId: "visit-1042", expectedRevision: revision });
  expect(await refusal(api.prescribing.simulate(simulate))).toEqual(["PRECONDITION_FAILED", ["Interaction coverage"]]);
  // A paracetamol allergy in the visit's history blocks even though the card's answer was "no".
  ({ revision } = await api.encounter.edit({ encounterId: "visit-1042", expectedRevision: revision, medicationEntries: confirmed,
    historyFacts: [{ id: "f1", category: "allergy", value: "Paracetamol — rash", source: "Patient interview", date: "2026-09-26", revision }] }));
  await api.prescribing.review({ encounterId: "visit-1042", expectedRevision: revision });
  expect(await refusal(api.prescribing.simulate(simulate))).toEqual(["PRECONDITION_FAILED", ["Paracetamol allergy"]]);
});

test("an amendment goes through the server: it needs an earlier receipt and a newer reviewed revision, names what it supersedes and why, and leaves that receipt unchanged", async () => {
  const api = await signedIn();
  const amend = { encounterId: "visit-1042", requestId: "rx-amend", approvedBy: "dr-aisyah", reason: "Weight re-measured at 64 kg" };
  expect(await refusal(api.prescribing.amend(amend))).toEqual(["PRECONDITION_FAILED", []]); // nothing to amend yet
  const edited = await api.encounter.edit({ encounterId: "visit-1042", expectedRevision: 1, prescriptionInputs: eligible, medicationEntries: confirmed, proposedMedicine: regimen });
  await api.prescribing.review({ encounterId: "visit-1042", expectedRevision: edited.revision });
  const first = await api.prescribing.simulate(simulate);
  // Nothing recorded since that receipt: nothing to amend.
  expect(await refusal(api.prescribing.amend(amend))).toEqual(["PRECONDITION_FAILED", []]);

  // The amended record must be reviewed again before the server writes anything.
  const amended = await api.encounter.edit({ encounterId: "visit-1042", expectedRevision: 2, prescriptionInputs: { ...eligible, weightKg: "64" } });
  expect(await refusal(api.prescribing.amend(amend))).toEqual(["PRECONDITION_FAILED", ["Current medication review"]]);
  await api.prescribing.review({ encounterId: "visit-1042", expectedRevision: amended.revision });
  expect(await code(api.prescribing.amend({ ...amend, approvedBy: "dr-someone-else" }))).toBe("FORBIDDEN");
  const receipt = await api.prescribing.amend(amend);
  expect(receipt).toMatchObject({ kind: "prescription", requestId: "rx-amend", revision: 3, approvedBy: "dr-aisyah",
    payload: { medication: "Paracetamol", dose: "1000", transmitted: false, amendment: { reason: "Weight re-measured at 64 kg", supersedes: "rx-1" } } });
  expect(await api.prescribing.amend(amend)).toEqual(receipt); // a replay returns it
  expect(await api.prescribing.simulate(simulate)).toEqual(first); // the earlier receipt is unchanged
});

test("a note save appends the next revision; a save against an older revision is refused and the latest stays", async () => {
  const api = await signedIn();
  // The seed gives Amelia no note (hers is saved from her recorded consultation), so here her visit starts at revision 0.
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
  const codes = await Promise.all([api.prescribing.review({ encounterId: "visit-1042", expectedRevision: 1 }), api.prescribing.simulate(simulate), api.prescribing.amend({ ...simulate, reason: "x" }),
    api.note.get({ encounterId: "visit-1042" }), api.note.save({ encounterId: "visit-1042", sentences: [], expectedRevision: 0 })].map(code));
  expect(codes).toEqual(["UNAUTHORIZED", "UNAUTHORIZED", "UNAUTHORIZED", "UNAUTHORIZED", "UNAUTHORIZED"]);
});
