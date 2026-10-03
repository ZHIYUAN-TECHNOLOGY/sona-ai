import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { encounters, hospitalMembers, hospitals, notes, provenance } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { CODES } from "@sona-ai/domain/claim";
import { huddle } from "@sona-ai/domain/ward";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { Models } from "../models";
import { stubModels } from "../models";
import { appRouter } from "./index";

/**
 * The visit screens' model answers: briefing, reasoning, discharge draft, claim codes and the huddle
 * brief. Each is scoped to the caller's hospital, logged in provenance, and labelled a fixture until a
 * model answers (then the model's version is what provenance records).
 */
const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

async function world(models?: Models) {
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T09:00:00+08:00"));
  await addClinician(db, "dr-aisyah");
  const as = (id: string | null) => createRouterClient(appRouter, { context: { db, session: id ? user(id) : null, models } });
  return { db, api: as("dr-aisyah"), as };
}

test("briefing and reasoning read the patient's own record, are labelled fixtures and logged with their sources", async () => {
  const { db, api } = await world();
  const brief = await api.encounter.briefing({ encounterId: "visit-1042" });
  expect(brief.source).toBe("fixture");
  expect(brief.lines).toEqual(["Cough for five days, with fever since yesterday.", "Allergy recorded: Penicillin."]);
  const daniel = await api.encounter.briefing({ encounterId: "visit-1086" });
  expect(daniel.lines.at(-1)).toContain("History is incomplete");
  const why = await api.encounter.reasoning({ encounterId: "visit-1042", question: "What else could this be?" });
  expect(why).toMatchObject({ source: "fixture", sourceIds: [] });
  expect(why.answer).toStartWith("Sample reasoning only");

  const logs = await db.select().from(provenance).where(eq(provenance.encounterId, "visit-1042"));
  expect(logs.map(l => [l.kind, l.model])).toEqual([["briefing", "fixture"], ["reasoning", "fixture"]]);
  // The briefing cites the record it read (history, observations, transcript), never the reference library.
  expect(logs[0]!.sourceIds).toEqual(["history", "vitals", "consultation"]);
  expect(logs[0]!.output).toEqual({ lines: brief.lines });
});

test("the discharge draft is the patient's own plan in the chosen language: Amelia's authored one, Nurul's from her record", async () => {
  const { db, api } = await world();
  const amelia = await api.discharge.draft({ encounterId: "visit-1042", language: "zh" });
  expect(amelia).toMatchObject({ source: "fixture", language: "zh" });
  expect(amelia.leaflet).toStartWith("您因肺部感染接受了治疗。请每天服用一次阿奇霉素");
  expect(amelia.summary).toStartWith("Admitted with five days of cough");
  const nurul = await api.discharge.draft({ encounterId: "visit-2002", language: "en" });
  expect(nurul.leaflet).toStartWith("You were treated for a kidney infection.");
  expect(nurul.summary).toStartWith("Acute pyelonephritis. Day 3 of antibiotics for pyelonephritis.");
  expect((await db.select().from(provenance).where(eq(provenance.kind, "discharge-draft"))).map(l => [l.encounterId, l.model])).toEqual([["visit-1042", "fixture"], ["visit-2002", "fixture"]]);
});

test("a discharge is checked against the patient's own plan: Nurul's take-home list and her bed", async () => {
  const { db, api } = await world();
  // Her medicines are confirmed; her letter, her own follow-up (worded for her infection) and the pending sensitivities block, as her ward bed shows.
  await db.update(encounters).set({ state: { discharge: { medsConfirmed: true } } }).where(eq(encounters.id, "visit-2002"));
  const refused = await api.discharge.request({ encounterId: "visit-2002", requestId: "d-1", approvedBy: "dr-aisyah" }).catch(e => e);
  expect(refused.code).toBe("PRECONDITION_FAILED");
  expect(refused.data.blockers.map((b: { label: string; detail: string }) => [b.label, b.detail])).toEqual([
    ["Final guarantee letter", "Synthetic insurer · requested today"],
    ["Follow-up booked", "Clinic review · 1–2 weeks, with the urine culture result"],
    ["Urine culture sensitivities", "Pending"],
  ]);
});

test("claim codes come from the note's sentences, each citing one and checked against the ICD-10 table", async () => {
  const { api } = await world();
  // Amelia has no saved note, so the claim's own excerpt is coded: the authored four, the diagnoses found in the table.
  const amelia = await api.claim.suggestCodes({ encounterId: "visit-1042" });
  expect(amelia.source).toBe("fixture");
  expect(amelia.codes.map(c => [c.code, c.evidence, c.inTable])).toEqual([["J18.9", "diagnosis", true], ["J45.9", "asthma", true], ["Z88.0", "allergy", true], ["87.44", "xray", undefined]]);
  expect(amelia.codes.map(c => c.code)).toEqual(CODES.map(c => c.code));
  // Daniel's saved note names no codable condition: no codes, rather than a guess.
  expect((await api.claim.suggestCodes({ encounterId: "visit-1086" })).codes).toEqual([]);
  // A saved note is what gets coded, and a code citing a sentence that is not there is dropped.
  const invented: Models = { ...stubModels, suggestCodes: async () => ({ source: "model", model: "gemma-test", codes: [
    { code: "J18.9", label: "Pneumonia", kind: "Principal", evidence: "assessment" }, { code: "J45.9", label: "Asthma", kind: "Secondary", evidence: "nowhere" },
    { code: "J18.99", label: "Pneumonia, made up", kind: "Secondary", evidence: "assessment" },
  ] }) };
  const { api: modelled, db: db2 } = await world(invented);
  await db2.insert(notes).values({ id: "note-visit-1042-1", encounterId: "visit-1042", revision: 1, sentences: [{ id: "assessment", text: "Right lower lobe pneumonia." }] });
  const r = await modelled.claim.suggestCodes({ encounterId: "visit-1042" });
  expect(r).toMatchObject({ source: "model", model: "gemma-test", sentences: [{ id: "assessment" }] });
  // The ungrounded asthma code is dropped; a code the WHO table lacks is kept but flagged.
  expect(r.codes.map(c => [c.code, c.inTable])).toEqual([["J18.9", true], ["J18.99", false]]);
  const [log] = await db2.select().from(provenance).where(eq(provenance.kind, "claim-codes"));
  expect(log).toMatchObject({ model: "gemma-test", sourceIds: ["assessment", "assessment"] });
});

test("a model codes a note once: asked again, its stored codes come back still labelled with it; a fixture or a changed note is asked again", async () => {
  let calls = 0, awake = false;
  const { api } = await world({ ...stubModels, suggestCodes: async input => {
    calls++;
    const codes = await stubModels.suggestCodes(input);
    return awake ? { codes: codes.codes, source: "model", model: "gemma-test" } : codes;
  } });
  expect((await api.claim.suggestCodes({ encounterId: "visit-1042" })).source).toBe("fixture");
  awake = true;
  const coded = await api.claim.suggestCodes({ encounterId: "visit-1042" });
  expect(await api.claim.suggestCodes({ encounterId: "visit-1042" })).toEqual(coded);
  expect([coded.source, calls]).toEqual(["model", 2]);
  // A fix adds a sentence to the note, so the note is coded again.
  await api.claim.update({ encounterId: "visit-1042", organismConfirmed: true });
  await api.claim.suggestCodes({ encounterId: "visit-1042" });
  expect(calls).toBe(3);
});

test("a hosted model is offered the WHO ICD-10 table's codes for the note's words to pick from", async () => {
  let offered: { code: string; label: string }[] | undefined;
  const { api } = await world({ ...stubModels, suggestCodes: input => { offered = input.candidates; return stubModels.suggestCodes(input); } });
  await api.claim.suggestCodes({ encounterId: "visit-1042" });
  expect(offered?.map(c => c.code)).toEqual(expect.arrayContaining(["J18.9", "J45.9", "Z88.0"]));
});

test("the huddle brief reads the live ward and its owners, logged without a visit", async () => {
  const { db, api } = await world();
  await api.ward.assignOwner({ blockerId: "adm-2002-gl", owner: "Billing" });
  const brief = await api.ward.huddle();
  expect(brief.source).toBe("fixture");
  expect(brief.lines).toEqual(huddle(await api.ward.beds(), { "adm-2002-gl": "Billing" }));
  const [log] = await db.select().from(provenance).where(eq(provenance.kind, "huddle-brief"));
  expect(log).toMatchObject({ encounterId: null, model: "fixture" });
  expect(log!.sourceIds).toContain("adm-2002-gl");
});

test("every visit answer needs a login and stays inside the caller's hospital", async () => {
  const { db, as } = await world();
  const anon = as(null);
  for (const call of [anon.encounter.briefing({ encounterId: "visit-1042" }), anon.discharge.draft({ encounterId: "visit-1042", language: "en" }), anon.claim.suggestCodes({ encounterId: "visit-1042" }), anon.ward.huddle()])
    expect((await call.catch(e => e)).code).toBe("UNAUTHORIZED");
  await db.insert(hospitals).values({ id: "other", name: "Other Hospital (synthetic)" });
  await db.insert(hospitalMembers).values({ userId: "dr-other", hospitalId: "other" });
  const other = as("dr-other");
  for (const call of [other.encounter.briefing({ encounterId: "visit-1042" }), other.encounter.reasoning({ encounterId: "visit-1042", question: "Why?" }), other.discharge.draft({ encounterId: "visit-1042", language: "en" }), other.claim.suggestCodes({ encounterId: "visit-1042" })])
    expect((await call.catch(e => e)).code).toBe("NOT_FOUND");
  // Another hospital's ward is empty to them, and nothing about Amelia was logged for them.
  expect((await other.ward.huddle()).lines[0]).toStartWith("0 ready to go");
  expect(await db.select().from(provenance).where(eq(provenance.encounterId, "visit-1042"))).toEqual([]);
});
