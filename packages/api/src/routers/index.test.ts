import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { encounters, guaranteeLetters, hospitalMembers, hospitals, labResults, notes } from "@sona-ai/db/schema/clinical";
import { runNightlyAudit } from "../audit-job";
import { seedDemo } from "@sona-ai/db/seed";
import { createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { appRouter } from "./index";

const session = {
  user: { id: "dr-aisyah", name: "Dr Aisyah", email: "aisyah@demo.test", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: "s1", userId: "dr-aisyah", token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session;

async function signedIn(signed = true, clock = { now: new Date("2026-09-26T10:00:00+08:00") }) {
  const db = await createTestDb();
  await seedDemo(db);
  return { db, clock, api: createRouterClient(appRouter, { context: { db, session: signed ? session : null, now: () => clock.now } }) };
}

test("only the health check is open; every clinical route needs a signed-in user", async () => {
  const { api } = await signedIn(false);
  expect(await api.healthCheck()).toBe("OK");
  const calls: [string, () => Promise<unknown>][] = [
    ["tasks.list", () => api.tasks.list()],
    ["encounter.get", () => api.encounter.get({ encounterId: "visit-1042" })],
    ["encounter.edit", () => api.encounter.edit({ encounterId: "visit-1042", expectedRevision: 1, proposedMedicine: "Paracetamol" })],
    ["discharge.request", () => api.discharge.request({ encounterId: "visit-1042", requestId: "r1", approvedBy: "dr-aisyah" })],
    ["ward.assignOwner", () => api.ward.assignOwner({ blockerId: "adm-1042-gl", owner: "Billing" })],
    ["discharge.update", () => api.discharge.update({ encounterId: "visit-1042", medsConfirmed: true })],
    ["claim.send", () => api.claim.send({ encounterId: "visit-1042", requestId: "c0", approvedBy: "dr-aisyah" })],
    ["claim.status", () => api.claim.status({ encounterId: "visit-1042" })],
    ["audit.list", () => api.audit.list()],
  ];
  for (const [name, call] of calls) {
    const error = await call().then(() => null, (e: { code?: string }) => e);
    expect([name, error?.code]).toEqual([name, "UNAUTHORIZED"]);
  }
});

const inputs = { weightKg: "62", liverDisease: "no", kidneyDisease: "no", alcoholRisk: "no", paracetamolAllergy: "no" } as const;
const azithromycin = { id: "m-azi", name: "Azithromycin", ingredient: "azithromycin", formulation: "500 mg tablet", confirmed: true };

test("an eligibility edit bumps the revision and invalidates the medication review taken at the old one", async () => {
  const { api, db } = await signedIn();
  // The medication review is recorded by the encounter agent; here it has already run at revision 1.
  await db.update(encounters).set({ state: { medicationCheckedRevision: 1 } }).where(eq(encounters.id, "visit-1042"));
  expect(await api.encounter.get({ encounterId: "visit-1042" })).toEqual({ encounterId: "visit-1042", revision: 1, state: { medicationCheckedRevision: 1 } });

  const edited = await api.encounter.edit({ encounterId: "visit-1042", expectedRevision: 1, prescriptionInputs: inputs });
  expect(edited.revision).toBe(2);
  expect(edited.state.reviewInvalidated).toBe(true);
  expect(edited.state.medicationCheckedRevision).not.toBe(2);
  expect(edited.state.prescriptionInputs).toEqual(inputs);
  expect(await api.encounter.get({ encounterId: "visit-1042" })).toEqual(edited);
});

test("a medicine edit moves the revision on, and a write against the old revision is refused", async () => {
  const { api } = await signedIn();
  const edited = await api.encounter.edit({ encounterId: "visit-1086", expectedRevision: 1, medicationEntries: [azithromycin] });
  expect(edited.revision).toBe(2);
  expect(edited.state.reviewInvalidated).toBeFalsy(); // no review had run, so there is nothing to rerun
  const stale = await api.encounter.edit({ encounterId: "visit-1086", expectedRevision: 1, proposedMedicine: "Paracetamol" }).catch(e => e);
  expect(stale.code).toBe("CONFLICT");
  expect(await api.encounter.get({ encounterId: "visit-1086" })).toEqual(edited);
  expect((await api.encounter.get({ encounterId: "visit-404" }).catch(e => e)).code).toBe("NOT_FOUND");
});

const dischargeAmelia = { encounterId: "visit-1042", requestId: "req-discharge-1", approvedBy: "dr-aisyah" };

test("a discharge is refused while any blocker is open, and the refusal names them", async () => {
  const { api } = await signedIn();
  const error = await api.discharge.request(dischargeAmelia).catch(e => e);
  expect(error.code).toBe("PRECONDITION_FAILED");
  expect(error.data.blockers.map((b: { id: string }) => b.id)).toEqual(["gl", "meds", "followup"]);
  expect(await api.tasks.list()).toEqual([]);
});

test("with every blocker cleared the discharge is receipted once, and a replay returns the same receipt", async () => {
  const { api, db } = await signedIn();
  // Cleared elsewhere: the insurer's final letter arrived, and the doctor confirmed medicines and booked follow-up.
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: new Date() }).where(eq(guaranteeLetters.id, "gl-1042"));
  await db.update(encounters).set({ state: { discharge: { glReceived: false, medsConfirmed: true, followUp: "2w", language: "ms" } } }).where(eq(encounters.id, "visit-1042"));

  const receipt = await api.discharge.request(dischargeAmelia);
  expect(receipt).toMatchObject({ kind: "discharge", ...dischargeAmelia, revision: 1 });
  expect(await api.discharge.request(dischargeAmelia)).toEqual(receipt);
  expect(await api.discharge.request({ ...dischargeAmelia, requestId: "req-discharge-2" })).toEqual(receipt); // already discharged
  expect((await api.tasks.list()).map(t => [t.kind, t.owner]).sort()).toEqual([["discharge", "Billing"], ["discharge", "Clinic clerk"]]);
  expect((await api.encounter.get({ encounterId: "visit-1042" })).state.discharge?.dischargedAt).toBeString();

  const reused = await api.discharge.request({ ...dischargeAmelia, encounterId: "visit-1086" }).catch(e => e);
  expect(reused.code).toBe("CONFLICT");
});

test("assigning an owner to a ward blocker creates one blocker-owner task, however often it is sent", async () => {
  const { api } = await signedIn();
  const first = await api.ward.assignOwner({ blockerId: "adm-1042-meds", owner: "Pharmacy" });
  const again = await api.ward.assignOwner({ blockerId: "adm-1042-meds", owner: "Pharmacy" });
  expect(again.id).toBe(first.id);
  const list = await api.tasks.list();
  expect(list.map(t => [t.kind, t.owner, t.title])).toEqual([["blocker-owner", "Pharmacy", "Bed 6: Take-home medicines"]]);
});

test("reassigning a blocker moves the same task to the new owner; an unknown blocker is refused", async () => {
  const { api } = await signedIn();
  await api.ward.assignOwner({ blockerId: "adm-1042-gl", owner: "Nurse" });
  await api.ward.assignOwner({ blockerId: "adm-1042-gl", owner: "Billing" });
  expect((await api.tasks.list()).map(t => [t.owner, t.title])).toEqual([["Billing", "Bed 6: Final guarantee letter"]]);
  const error = await api.ward.assignOwner({ blockerId: "b99-nothing", owner: "Porter" }).catch(e => e);
  expect(error.code).toBe("NOT_FOUND");
});

test("confirming take-home medicines and booking the follow-up through the API leaves only the guarantee letter blocking", async () => {
  const { api } = await signedIn();
  await api.discharge.update({ encounterId: "visit-1042", medsConfirmed: true, followUp: "2w", language: "en" });
  const refusal = await api.discharge.request({ encounterId: "visit-1042", requestId: "r-upd", approvedBy: "dr-aisyah" }).then(() => null, (e: { data?: { blockers?: { id: string }[] } }) => e);
  expect(refusal?.data?.blockers?.map(b => b.id)).toEqual(["gl"]);
  const { state } = await api.encounter.get({ encounterId: "visit-1042" });
  expect(state.discharge).toMatchObject({ medsConfirmed: true, followUp: "2w", language: "en" });
});

test("a discharge approved by a blank name is refused as unapproved, before any blocker is considered", async () => {
  const { api } = await signedIn();
  const refusal = await api.discharge.request({ encounterId: "visit-1042", requestId: "r-blank", approvedBy: "   " }).then(() => null, (e: { code?: string; data?: { reason?: string } }) => e);
  expect([refusal?.code, refusal?.data?.reason]).toEqual(["PRECONDITION_FAILED", "unapproved"]);
});

test("a claim is refused while the organism and the reason for IV antibiotics are undocumented, and the refusal names them", async () => {
  const { api } = await signedIn();
  const refusal = await api.claim.send({ encounterId: "visit-1042", requestId: "c1", approvedBy: "dr-aisyah" }).then(() => null, (e: { data?: { reason?: string; open?: string[] } }) => e);
  expect(refusal?.data).toEqual({ reason: "blocked", open: ["Organism documented", "Reason for IV antibiotics"] });
});

test("once documented, the claim is sent once; a minute later the insurer approves and the discharge stops waiting on the guarantee letter", async () => {
  const { api, clock } = await signedIn();
  await api.claim.update({ encounterId: "visit-1042", organismConfirmed: true, ivReasonAdded: true });
  const sent = await api.claim.send({ encounterId: "visit-1042", requestId: "c2", approvedBy: "dr-aisyah" });
  expect(await api.claim.send({ encounterId: "visit-1042", requestId: "c2", approvedBy: "dr-aisyah" })).toEqual(sent);
  expect((await api.claim.status({ encounterId: "visit-1042" })).status).toBe("sent");
  clock.now = new Date(clock.now.getTime() + 61_000);
  expect((await api.claim.status({ encounterId: "visit-1042" })).status).toBe("approved");
  await api.discharge.update({ encounterId: "visit-1042", medsConfirmed: true, followUp: "2w" });
  const receipt = await api.discharge.request({ encounterId: "visit-1042", requestId: "d-after-claim", approvedBy: "dr-aisyah" });
  expect(receipt.kind).toBe("discharge");
});

test("the nightly audit raises a lab-only diagnosis once, priced from the casemix weight", async () => {
  const { db, api, clock } = await signedIn();
  await db.insert(notes).values({ id: "n-1086", encounterId: "visit-1086", revision: 1, sentences: [{ id: "s1", text: "Breathless on exertion, onset unclear." }] });
  await db.insert(labResults).values({ id: "hb-1086", patientId: "SYN-1086", test: "Hb", value: "9.8", unit: "g/dL", flag: "low", sourceId: "lab-hb-1086" });
  await runNightlyAudit(db, "demo", clock.now);
  await runNightlyAudit(db, "demo", clock.now);
  const items = await api.audit.list();
  expect(items.map(i => [i.patientId, i.toCode, i.riskCents])).toEqual([["SYN-1086", "D64.9", 63000]]);
});

test("a doctor from another hospital cannot see the demo ward's encounters or tasks", async () => {
  const { db, api } = await signedIn();
  await api.ward.assignOwner({ blockerId: "adm-1042-gl", owner: "Billing" }); // dr-aisyah joins the demo hospital on first use
  await db.insert(hospitals).values({ id: "other", name: "Other Hospital (synthetic)" });
  await db.insert(hospitalMembers).values({ userId: "dr-other", hospitalId: "other" });
  const other = { ...session, user: { ...session.user, id: "dr-other" } } as Session;
  const theirs = createRouterClient(appRouter, { context: { db, session: other } });
  const error = await theirs.encounter.get({ encounterId: "visit-1042" }).then(() => null, (e: { code?: string }) => e);
  expect(error?.code).toBe("NOT_FOUND");
  expect(await theirs.tasks.list()).toEqual([]);
  expect((await api.tasks.list()).length).toBe(1);
});

test("a doctor cannot approve a discharge or a claim in someone else's name", async () => {
  const { api } = await signedIn();
  const asOther = { encounterId: "visit-1042", requestId: "r-other", approvedBy: "dr-someone-else" };
  const codes = await Promise.all([api.discharge.request(asOther), api.claim.send({ ...asOther, requestId: "c-other" })].map(p => p.then(() => null, (e: { code?: string }) => e.code)));
  expect(codes).toEqual(["FORBIDDEN", "FORBIDDEN"]);
});

test("owners attach to the bed's live blockers: once the guarantee letter arrives, its blocker is gone", async () => {
  const { db, api } = await signedIn();
  await api.ward.assignOwner({ blockerId: "adm-1042-gl", owner: "Billing" });
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: new Date() }).where(eq(guaranteeLetters.admissionId, "adm-1042"));
  const error = await api.ward.assignOwner({ blockerId: "adm-1042-gl", owner: "Nurse" }).then(() => null, (e: { code?: string }) => e.code);
  expect(error).toBe("NOT_FOUND");
  await api.discharge.update({ encounterId: "visit-1042", medsConfirmed: true });
  expect(await api.ward.assignOwner({ blockerId: "adm-1042-meds", owner: "Pharmacy" }).then(() => "ok", (e: { code?: string }) => e.code)).toBe("NOT_FOUND");
});

test("recording a medication review at the current revision clears the invalidation; a review of an old revision is refused", async () => {
  const { api } = await signedIn();
  const edited = await api.encounter.edit({ encounterId: "visit-1042", expectedRevision: 1, prescriptionInputs: inputs });
  const reviewed = await api.encounter.recordReview({ encounterId: "visit-1042", expectedRevision: edited.revision });
  expect([reviewed.revision, reviewed.state.medicationCheckedRevision, Boolean(reviewed.state.reviewInvalidated)]).toEqual([edited.revision, edited.revision, false]);
  const stale = await api.encounter.recordReview({ encounterId: "visit-1042", expectedRevision: 1 }).then(() => null, (e: { code?: string }) => e.code);
  expect(stale).toBe("CONFLICT");
});
