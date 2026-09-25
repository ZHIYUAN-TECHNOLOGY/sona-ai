import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { encounters, guaranteeLetters } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { appRouter } from "./index";

const session = {
  user: { id: "dr-aisyah", name: "Dr Aisyah", email: "aisyah@demo.test", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: "s1", userId: "dr-aisyah", token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session;

async function signedIn(signed = true) {
  const db = await createTestDb();
  await seedDemo(db);
  return { db, api: createRouterClient(appRouter, { context: { db, session: signed ? session : null } }) };
}

test("only the health check is open; every clinical route needs a signed-in user", async () => {
  const { api } = await signedIn(false);
  expect(await api.healthCheck()).toBe("OK");
  const calls: [string, () => Promise<unknown>][] = [
    ["tasks.list", () => api.tasks.list()],
    ["encounter.get", () => api.encounter.get({ encounterId: "visit-1042" })],
    ["encounter.edit", () => api.encounter.edit({ encounterId: "visit-1042", expectedRevision: 1, proposedMedicine: "Paracetamol" })],
    ["discharge.request", () => api.discharge.request({ encounterId: "visit-1042", requestId: "r1", approvedBy: "dr-aisyah" })],
    ["ward.assignOwner", () => api.ward.assignOwner({ blockerId: "b6-gl", owner: "Billing" })],
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
  const first = await api.ward.assignOwner({ blockerId: "b14-pharm", owner: "Pharmacy" });
  const again = await api.ward.assignOwner({ blockerId: "b14-pharm", owner: "Pharmacy" });
  expect(again.id).toBe(first.id);
  const list = await api.tasks.list();
  expect(list.map(t => [t.kind, t.owner, t.title])).toEqual([["blocker-owner", "Pharmacy", "Bed 14: Take-home analgesia"]]);
});

test("reassigning a blocker moves the same task to the new owner; an unknown blocker is refused", async () => {
  const { api } = await signedIn();
  await api.ward.assignOwner({ blockerId: "b6-gl", owner: "Nurse" });
  await api.ward.assignOwner({ blockerId: "b6-gl", owner: "Billing" });
  expect((await api.tasks.list()).map(t => [t.owner, t.title])).toEqual([["Billing", "Bed 6: Final guarantee letter"]]);
  const error = await api.ward.assignOwner({ blockerId: "b99-nothing", owner: "Porter" }).catch(e => e);
  expect(error.code).toBe("NOT_FOUND");
});
