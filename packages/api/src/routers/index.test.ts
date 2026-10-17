import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { encounters, guaranteeLetters, hospitalMembers, hospitals, labResults, provenance } from "@sona-ai/db/schema/clinical";
import { runNightlyAudit } from "../audit-job";
import { decideReview, reviewPacket, reviewTokenOf } from "../insurer";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { EMPTY_CLAIM, ORGANISM_UNKNOWN, PNEUMONIA_CONFIRMED, ivReason, noteFor } from "@sona-ai/domain/claim";
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
  await addClinician(db, "dr-aisyah");
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

const penicillin = { id: "h-pen", category: "allergy", value: "Penicillin (rash)", source: "Doctor", date: "26 Sep 2026", revision: 1 } as const;

test("a history edit is saved, bumps the revision and invalidates the review; a malformed fact is refused", async () => {
  const { api, db } = await signedIn();
  await db.update(encounters).set({ state: { medicationCheckedRevision: 1 } }).where(eq(encounters.id, "visit-1042"));
  const edited = await api.encounter.edit({ encounterId: "visit-1042", expectedRevision: 1, historyFacts: [penicillin] });
  expect([edited.revision, edited.state.reviewInvalidated]).toEqual([2, true]);
  expect((await api.encounter.get({ encounterId: "visit-1042" })).state.historyFacts).toEqual([penicillin]);
  const bad = await api.encounter.edit({ encounterId: "visit-1042", expectedRevision: 2, historyFacts: [{ ...penicillin, category: "hobby" as "allergy" }] }).catch(e => e);
  expect(bad.code).toBe("BAD_REQUEST");
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

test("a pending result or an unarranged ride home blocks the discharge, as the ward shows it", async () => {
  const { api, db } = await signedIn();
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: new Date() }).where(eq(guaranteeLetters.id, "gl-1042"));
  await db.update(encounters).set({ state: { discharge: { glReceived: true, medsConfirmed: true, followUp: "2w", language: "ms" }, transport: { label: "Ride home", detail: "Family free after 17:00" } } }).where(eq(encounters.id, "visit-1042"));
  await db.insert(labResults).values({ id: "lab-1042-crp", patientId: "SYN-1042", test: "CRP", value: "", flag: "pending", sourceId: "lab-1042-crp", receivedAt: new Date() });

  const ward = (await api.ward.beds()).find(b => b.bed === "Bed 6")!;
  const refusal = await api.discharge.request(dischargeAmelia).then(() => null, (e: { code?: string; data?: { blockers?: { id: string; label: string }[] } }) => e);
  expect(refusal?.code).toBe("PRECONDITION_FAILED");
  expect(refusal?.data?.blockers?.map(b => b.label).sort()).toEqual(ward.blockers.map(b => b.label).sort());
  expect(refusal?.data?.blockers?.map(b => b.label).sort()).toEqual(["CRP", "Ride home"]);
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

test("discharge.plan returns the exact checks discharge.request enforces: with no waits, an unchosen follow-up still blocks both", async () => {
  const { api, db } = await signedIn();
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: new Date() }).where(eq(guaranteeLetters.id, "gl-1042"));
  await api.discharge.update({ encounterId: "visit-1042", medsConfirmed: true });
  const { waits, checks, state } = await api.discharge.plan({ encounterId: "visit-1042" });
  expect(waits).toEqual([]);
  expect(state).toMatchObject({ medsConfirmed: true, glReceived: true });
  expect(checks.filter(c => c.status === "blocked").map(c => c.id)).toEqual(["followup"]);
  const refusal = await api.discharge.request(dischargeAmelia).then(() => null, (e: { data?: { blockers?: { id: string }[] } }) => e);
  expect(refusal?.data?.blockers).toEqual(checks.filter(c => c.status === "blocked"));
});

test("the doctor's edited discharge summary is saved trimmed and comes back with the plan", async () => {
  const { api } = await signedIn();
  await api.discharge.update({ encounterId: "visit-1042", summary: "  Cellulitis, improving on oral antibiotics.  " });
  expect((await api.discharge.plan({ encounterId: "visit-1042" })).state.summary).toBe("Cellulitis, improving on oral antibiotics.");
  expect(await api.discharge.update({ encounterId: "visit-1042", summary: "x".repeat(4001) }).then(() => null, (e: { code?: string }) => e.code)).toBe("BAD_REQUEST");
});

test("a discharge approved by a blank name is refused as unapproved, before any blocker is considered", async () => {
  const { api } = await signedIn();
  const refusal = await api.discharge.request({ encounterId: "visit-1042", requestId: "r-blank", approvedBy: "   " }).then(() => null, (e: { code?: string; data?: { reason?: string } }) => e);
  expect([refusal?.code, refusal?.data?.reason]).toEqual(["PRECONDITION_FAILED", "unapproved"]);
});

test("a claim is refused while the visit's saved note leaves a criterion open, and the refusal names each: every one with no note, then the organism and the reason for IV antibiotics", async () => {
  const { api } = await signedIn();
  const refused = () => api.claim.send({ encounterId: "visit-1042", requestId: "c1", approvedBy: "dr-aisyah" }).then(() => null, (e: { data?: { reason?: string; open?: string[] } }) => e?.data);
  // No note is saved for the visit yet, and none is assumed.
  expect(await refused()).toEqual({ reason: "blocked", open: ["Severity score documented", "Imaging result attached"] });
  await api.note.save({ encounterId: "visit-1042", expectedRevision: 0, sentences: noteFor(EMPTY_CLAIM) });
  expect(await refused()).toEqual({ reason: "blocked", open: ["Organism documented", "Reason for IV antibiotics"] });
  // The IV fix carries the doctor's own reason; without it nothing is written for them.
  expect(await api.claim.update({ encounterId: "visit-1042", ivReasonAdded: true }).then(() => null, (e: { code?: string }) => e.code)).toBe("BAD_REQUEST");
  expect((await api.claim.status({ encounterId: "visit-1042" })).checks?.map(c => c.status)).toEqual(["passed", "passed", "passed", "blocked", "blocked"]);
});

test("the demo's letter rests on what the visit produced: the recorded consultation's note, the chart's CURB-65 and the read X-ray, with the doctor confirming pneumonia on the film", async () => {
  const { api, db, clock } = await signedIn();
  const checks = async () => Object.fromEntries((await api.claim.status({ encounterId: "visit-1042" })).checks!.map(c => [c.id, [c.status, c.detail]]));
  // The note as the scribe drafts it from her consultation: pneumonia suspected, an X-ray ordered, no score, no film read.
  await api.note.save({ encounterId: "visit-1042", expectedRevision: 0, sentences: [
    { id: "subjective", text: "Five days of cough with yellow sputum, fever since yesterday, rigors overnight. Asthma, reliever three to four times a day. Penicillin allergy (rash)." },
    { id: "objective", text: "Temperature 38.1, pulse 96, SpO2 97% on room air. Bilateral wheeze, reduced air entry at the right base." },
    { id: "assessment", text: "Possible community-acquired pneumonia." },
    { id: "plan", text: "Chest X-ray today to check for pneumonia. Paracetamol 1 g every 6 hours as needed. If pneumonia, azithromycin, not a penicillin." },
  ] });
  // Severity comes from her chart (all five CURB-65 factors recorded); nothing else is assumed.
  expect(await checks()).toEqual({
    severity: ["passed", "“CURB-65 0 from the chart: confusion AMT 10/10, urea 5.1 mmol/L, respiratory rate 18 /min, blood pressure 124/78 mmHg, age 42.”"],
    imaging: ["blocked", "No imaging result in the note"],
    diagnosis: ["blocked", "The note names pneumonia only as possible: confirm it from the X-ray"],
    organism: ["blocked", "J18.9 needs the note to say the organism is unknown"],
  });
  // Pneumonia cannot be confirmed on a film nobody has read.
  expect(await api.claim.update({ encounterId: "visit-1042", diagnosisConfirmed: true }).then(() => null, (e: { code?: string }) => e.code)).toBe("PRECONDITION_FAILED");
  // Her film uploaded and read by a model, as xray.upload and xray.read store them.
  await db.update(encounters).set({ state: { xray: { key: "demo/xray/visit-1042/f", contentType: "image/png", uploadedAt: "2026-09-26T01:30:00.000Z" } } }).where(eq(encounters.id, "visit-1042"));
  await db.insert(provenance).values({ id: "read-1", encounterId: "visit-1042", kind: "xray-read", output: { findings: ["Right lower zone consolidation."] }, sourceIds: [], model: "medgemma-1.5-4b" });
  expect((await checks()).imaging).toEqual(["passed", expect.stringMatching(/^“Chest X-ray \(26 Sept? 2026\), Sona Vision reading, not validated: Right lower zone consolidation.”$/)]);
  await api.claim.update({ encounterId: "visit-1042", diagnosisConfirmed: true, organismConfirmed: true });
  expect((await api.note.get({ encounterId: "visit-1042" })).sentences.slice(-2)).toEqual([PNEUMONIA_CONFIRMED, ORGANISM_UNKNOWN]);
  expect(Object.values(await checks()).every(([status]) => status === "passed")).toBe(true);
  await api.claim.send({ encounterId: "visit-1042", requestId: "c-real", approvedBy: "dr-aisyah" });
  // The insurer reads the same: the note's confirmation and what the visit attached.
  const packet = (await reviewPacket(db, await reviewTokenOf(db, "visit-1042"), clock.now))!;
  expect(packet.criteria.map(c => [c.id, c.status])).toEqual([["severity", "passed"], ["imaging", "passed"], ["diagnosis", "passed"], ["organism", "passed"]]);
});

test("the claim's fixes save their sentences to the note as a new revision, once each, and then the claim sends", async () => {
  const { api } = await signedIn();
  // With no note saved there is nothing to add a sentence to.
  await api.claim.update({ encounterId: "visit-1042", organismConfirmed: true });
  expect((await api.note.get({ encounterId: "visit-1042" })).revision).toBe(0);
  await api.note.save({ encounterId: "visit-1042", expectedRevision: 0, sentences: noteFor(EMPTY_CLAIM) });
  const fixes = { encounterId: "visit-1042", organismConfirmed: true, ivReasonAdded: true, ivReason: "vomiting on arrival, unable to keep oral tablets down." };
  await api.claim.update(fixes);
  await api.claim.update(fixes);
  const note = await api.note.get({ encounterId: "visit-1042" });
  expect(note.revision).toBe(2);
  expect(note.sentences.slice(-2)).toEqual([ORGANISM_UNKNOWN, ivReason(fixes.ivReason)]);
  expect((await api.claim.status({ encounterId: "visit-1042" })).checks?.every(c => c.status === "passed")).toBe(true);
  await api.claim.send({ encounterId: "visit-1042", requestId: "c-fixed", approvedBy: "dr-aisyah" });
  expect((await api.claim.status({ encounterId: "visit-1042" })).status).toBe("sent");
});

test("once documented, the claim is sent once; when the insurer approves, the discharge stops waiting on the guarantee letter", async () => {
  const { api, db, clock } = await signedIn();
  await api.note.save({ encounterId: "visit-1042", expectedRevision: 0, sentences: [...noteFor(EMPTY_CLAIM), ORGANISM_UNKNOWN, ivReason("vomiting on arrival, unable to keep oral tablets down.")] });
  const sent = await api.claim.send({ encounterId: "visit-1042", requestId: "c2", approvedBy: "dr-aisyah" });
  expect(await api.claim.send({ encounterId: "visit-1042", requestId: "c2", approvedBy: "dr-aisyah" })).toEqual(sent);
  expect((await api.claim.status({ encounterId: "visit-1042" })).status).toBe("sent");
  // No timer approves it any more: only the insurer's decision on the review page does.
  clock.now = new Date(clock.now.getTime() + 61_000);
  expect((await api.claim.status({ encounterId: "visit-1042" })).status).toBe("sent");
  await decideReview(db, await reviewTokenOf(db, "visit-1042"), "approve", "", clock.now);
  expect((await api.claim.status({ encounterId: "visit-1042" })).status).toBe("approved");
  await api.discharge.update({ encounterId: "visit-1042", medsConfirmed: true, followUp: "2w" });
  const receipt = await api.discharge.request({ encounterId: "visit-1042", requestId: "d-after-claim", approvedBy: "dr-aisyah" });
  expect(receipt.kind).toBe("discharge");
});

test("the nightly audit raises a lab-only diagnosis once, priced from the casemix weight", async () => {
  const { db, api, clock } = await signedIn();
  // The seed carries Daniel's note and a haemoglobin of 9.8 g/dL that the note does not mention.
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

test("running the audit from the app raises the seeded lab gap; querying it creates one coding-query task and closes the item", async () => {
  const { api } = await signedIn();
  expect((await api.audit.run()).raised).toBe(1);
  const [item] = await api.audit.list();
  expect([item?.patientId, item?.toCode]).toEqual(["SYN-1086", "D64.9"]);
  await api.audit.query({ itemId: item!.id });
  await api.audit.query({ itemId: item!.id });
  expect(await api.audit.list()).toEqual([]);
  const queries = (await api.tasks.list()).filter(t => t.kind === "coding-query");
  expect(queries.map(t => t.sourceId)).toEqual([item!.id]);
});

test("a task is reassigned and redated in place; another hospital's task is not found and an empty update is refused", async () => {
  const { db, api } = await signedIn();
  const task = await api.tasks.create({ encounterId: "visit-1042", title: "Review inhaler technique", owner: "Clinic nurse", due: "2026-10-03", requestId: "u1" });
  expect(await api.tasks.update({ taskId: task.id, owner: " Pharmacist " })).toMatchObject({ id: task.id, owner: "Pharmacist", due: "2026-10-03" });
  expect(await api.tasks.update({ taskId: task.id, due: "2026-10-10" })).toMatchObject({ owner: "Pharmacist", due: "2026-10-10" });
  expect((await api.tasks.update({ taskId: task.id, due: null })).due).toBeNull();
  expect((await api.tasks.list()).map(t => [t.id, t.owner])).toEqual([[task.id, "Pharmacist"]]);
  for (const bad of [{ taskId: task.id }, { taskId: task.id, owner: "  " }, { taskId: task.id, due: "3/10/2026" }])
    expect((await api.tasks.update(bad).catch(e => e)).code).toBe("BAD_REQUEST");
  expect((await api.tasks.update({ taskId: "no-such-task", owner: "Nurse" }).catch(e => e)).code).toBe("NOT_FOUND");
  await db.insert(hospitals).values({ id: "other", name: "Other Hospital (synthetic)" });
  await db.insert(hospitalMembers).values({ userId: "dr-other", hospitalId: "other" });
  const theirs = createRouterClient(appRouter, { context: { db, session: { ...session, user: { ...session.user, id: "dr-other" } } as Session } });
  expect((await theirs.tasks.update({ taskId: task.id, owner: "Someone" }).catch(e => e)).code).toBe("NOT_FOUND");
  expect((await api.tasks.list())[0]?.owner).toBe("Pharmacist");
});
