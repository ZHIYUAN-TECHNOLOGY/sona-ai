import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { encounters, hospitalMembers, hospitals, notes, observations, provenance } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { CODES, EMPTY_CLAIM, ORGANISM_UNKNOWN, noteFor } from "@sona-ai/domain/claim";
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
  // The briefing cites the record it read (history, observations), never the reference library; no transcript is listed, since no recording of the visit is saved.
  expect(logs[0]!.sourceIds).toEqual(["history", "vitals"]);
  expect(logs[0]!.output).toEqual({ lines: brief.lines });
});

test("the discharge draft is the patient's own plan in the chosen language, built from each one's record: Amelia's like Nurul's", async () => {
  const { db, api } = await world();
  const amelia = await api.discharge.draft({ encounterId: "visit-1042", language: "zh" });
  expect(amelia).toMatchObject({ source: "fixture", language: "zh" });
  expect(amelia.leaflet).toStartWith("您因肺部感染接受了治疗。请按医嘱服完抗生素");
  expect(amelia.summary).toStartWith("Community-acquired pneumonia, on a background of asthma. Penicillin allergy reported. Community-acquired pneumonia, mild, day 2.");
  const nurul = await api.discharge.draft({ encounterId: "visit-2002", language: "en" });
  expect(nurul.leaflet).toStartWith("You were treated for a kidney infection.");
  expect(nurul.summary).toStartWith("Acute pyelonephritis. Day 3 of antibiotics for pyelonephritis.");
  expect((await db.select().from(provenance).where(eq(provenance.kind, "discharge-draft"))).map(l => [l.encounterId, l.model])).toEqual([["visit-1042", "fixture"], ["visit-2002", "fixture"]]);
});

test("a discharge is checked against the visit's own rows: Nurul's letter as requested, her unchosen follow-up, her pending result, and her chart", async () => {
  const { db, api } = await world();
  // Her medicines are confirmed; her letter, the follow-up nobody has chosen and the pending sensitivities block, as her ward bed shows.
  await db.update(encounters).set({ state: { discharge: { medsConfirmed: true } } }).where(eq(encounters.id, "visit-2002"));
  const blockers = async () => {
    const refused = await api.discharge.request({ encounterId: "visit-2002", requestId: "d-1", approvedBy: "dr-aisyah" }).catch(e => e);
    expect(refused.code).toBe("PRECONDITION_FAILED");
    return refused.data.blockers.map((b: { label: string; detail: string }) => [b.label, b.detail]);
  };
  const waiting = [["Final guarantee letter", "Synthetic insurer · requested 09:00"], ["Follow-up booked", "Not chosen yet"], ["Urine culture sensitivities", "Pending"]];
  expect(await blockers()).toEqual(waiting);
  // A fever on the chart holds her too: the observations check reads the latest reading, it is not assumed stable.
  await db.update(observations).set({ value: 38.6 }).where(eq(observations.id, "obs-2002-temperature"));
  expect(await blockers()).toEqual([["Observations stable", "Temp 38.6 °C"], ...waiting]);
});

test("the discharge card's plan is read from the visit's rows: the charted take-home list, when the bed was marked fit, the letter, the chart, and a draft only once a model wrote one", async () => {
  const { api } = await world();
  const nurul = await api.discharge.plan({ encounterId: "visit-2002" });
  expect(nurul.plan.bed).toBe("Bed 2");
  expect(nurul.plan.meds.map(m => [m.name, m.change])).toEqual([["Cefuroxime", "changed"], ["Paracetamol", "new"]]);
  // Fit five hours before the seed's 09:00, the letter requested at the seed, six readings two hours before it, no draft.
  expect(nurul.plan.visit).toMatchObject({ fitAt: "2026-09-25T20:00:00.000Z", gl: { insurer: "Synthetic insurer", requestedAt: "2026-09-26T01:00:00.000Z" }, drafted: false });
  expect(nurul.plan.visit.vitals!.map(v => [v.kind, v.value, v.at])).toContainEqual(["temperature", 36.9, "2026-09-25T23:00:00.000Z"]);
  expect(nurul.plan.visit.vitals).toHaveLength(6);
  expect(nurul.waits).toEqual([{ id: "result-lab-2002-b2-result", label: "Urine culture sensitivities", detail: "Pending" }]);
  // A self-pay stay has no letter to wait for; a patient who is not admitted has no bed, fit time or letter at all.
  expect((await api.discharge.plan({ encounterId: "visit-2008" })).plan.visit.gl).toBeUndefined();
  expect((await api.discharge.plan({ encounterId: "visit-1086" })).plan).toMatchObject({ bed: "Ward bed", meds: [], visit: { vitals: [], drafted: false } });
  // The stub's rule-built draft is not a draft; a model's is, and only then does the summary check exist.
  await api.discharge.draft({ encounterId: "visit-2002", language: "en" });
  expect((await api.discharge.plan({ encounterId: "visit-2002" })).plan.visit.drafted).toBe(false);
  const { api: modelled } = await world({ ...stubModels, draftDischarge: async () => ({ source: "model", model: "gemma-test", summary: "s", leaflet: "l" }) });
  await modelled.discharge.draft({ encounterId: "visit-2002", language: "en" });
  expect((await modelled.discharge.plan({ encounterId: "visit-2002" })).plan.visit.drafted).toBe(true);
  expect(await api.discharge.plan({ encounterId: "visit-404" }).catch(e => e.code)).toBe("NOT_FOUND");
});

test("a discharge records what the rows say: minutes saved from when the bed was marked fit, one task for a self-pay stay, and a leaflet only when a model's draft was read", async () => {
  // Priya is fit with nothing in the way: her medicines confirmed, a follow-up chosen, no letter to wait for.
  const leave = async (models?: Models) => {
    const { db, api } = await world(models);
    await api.discharge.draft({ encounterId: "visit-2008", language: "ms" });
    const receipt = await api.discharge.request({ encounterId: "visit-2008", requestId: "d-priya", approvedBy: "dr-aisyah" });
    const [visit] = await db.select().from(encounters).where(eq(encounters.id, "visit-2008"));
    return { receipt, discharge: (visit!.state as { discharge: { leaflet?: unknown; savedMinutes: number } }).discharge, tasks: await api.tasks.list() };
  };
  const stubbed = await leave();
  // The stub's rule-picked leaflet was never a draft anyone approved, so none is recorded as going home.
  expect(stubbed.discharge.leaflet).toBeUndefined();
  expect(stubbed.tasks.map(t => t.title)).toEqual(["Book clinic review for Priya"]);
  const modelled = await leave({ ...stubModels, draftDischarge: async () => ({ source: "model", model: "gemma-test", summary: "s", leaflet: "Makan ubat seperti yang diarahkan." }) });
  expect(modelled.discharge.leaflet).toEqual({ language: "ms", text: "Makan ubat seperti yang diarahkan.", model: "gemma-test", approvedBy: "Dr dr-aisyah", approvedAt: expect.any(String) });
  // The context has no clock, so the discharge is at the wall clock's now, long after the seed marked her fit: nothing is claimed as saved.
  expect(modelled.discharge.savedMinutes).toBe(0);
});

test("the briefing's timeline is the dated rows of the record, oldest first, and a thin record gives a short one", async () => {
  const { api } = await world();
  const nurul = await api.encounter.timeline({ encounterId: "visit-2002" });
  expect(nurul.map(e => [e.at.toISOString(), e.title, e.detail])).toEqual([
    ["2026-09-24T01:00:00.000Z", "Urine culture sensitivities sent to the lab", "Result pending"],
    ["2026-09-25T20:00:00.000Z", "Marked fit for discharge", "Bed 2"],
    ["2026-09-25T22:00:00.000Z", "Note saved", "Two days of right loin pain, fever and dysuria before admission. Now pain-free, eating and walking."],
    ["2026-09-25T23:00:00.000Z", "Observations", "Temperature 36.9 °C · Pulse 78 bpm · Respiratory rate 16 /min · Oxygen saturation 99 % · Systolic 112 mmHg · Diastolic 70 mmHg"],
    ["2026-09-26T01:00:00.000Z", "Final guarantee letter requested", "Synthetic insurer"],
  ]);
  // Daniel's record holds little with a time on it: his two results, the note and today's visit. Nothing is added to fill it out.
  expect((await api.encounter.timeline({ encounterId: "visit-1086" })).map(e => e.title)).toEqual(["Hb 9.8 g/dL", "Note saved", "Potassium 3.1 mmol/L", "Clinic visit"]);
  // What a run does lands on it: an approved claim's receipt, here Amelia's note and send.
  await api.note.save({ encounterId: "visit-1042", expectedRevision: 0, sentences: [...noteFor(EMPTY_CLAIM), ORGANISM_UNKNOWN, { id: "iv", text: "IV first: vomiting." }] });
  await api.claim.send({ encounterId: "visit-1042", requestId: "c-t", approvedBy: "dr-aisyah" });
  const amelia = (await api.encounter.timeline({ encounterId: "visit-1042" })).map(e => e.title);
  expect(amelia).toEqual(expect.arrayContaining(["Observations", "Marked fit for discharge", "Final guarantee letter requested", "Note saved", "Guarantee letter request sent", "Clinic visit"]));
  expect(await api.encounter.timeline({ encounterId: "visit-404" }).catch(e => e.code)).toBe("NOT_FOUND");
});

test("claim codes come from the note's sentences, each citing one and checked against the ICD-10 table", async () => {
  const { api, db } = await world();
  // Amelia has no saved note: there is nothing to code, no excerpt stands in for one, and nothing is logged as an answer.
  expect(await api.claim.suggestCodes({ encounterId: "visit-1042" })).toEqual({ codes: [], sentences: [], source: "fixture" });
  expect(await db.select().from(provenance).where(eq(provenance.kind, "claim-codes"))).toEqual([]);
  // Once her note is saved, its sentences are coded: the keyword rule's four, the diagnoses found in the table.
  await api.note.save({ encounterId: "visit-1042", expectedRevision: 0, sentences: noteFor(EMPTY_CLAIM) });
  const amelia = await api.claim.suggestCodes({ encounterId: "visit-1042" });
  expect(amelia.source).toBe("fixture");
  expect(amelia.sentences).toEqual(noteFor(EMPTY_CLAIM));
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
  await api.note.save({ encounterId: "visit-1042", expectedRevision: 0, sentences: noteFor(EMPTY_CLAIM) });
  expect((await api.claim.suggestCodes({ encounterId: "visit-1042" })).source).toBe("fixture");
  awake = true;
  const coded = await api.claim.suggestCodes({ encounterId: "visit-1042" });
  expect(await api.claim.suggestCodes({ encounterId: "visit-1042" })).toEqual({ ...coded, storedAt: expect.any(Date) });
  expect([coded.source, calls]).toEqual(["model", 2]);
  // A fix saves a sentence to the note, so the note is coded again.
  await api.note.save({ encounterId: "visit-1042", expectedRevision: 1, sentences: [...noteFor(EMPTY_CLAIM), ORGANISM_UNKNOWN] });
  await api.claim.suggestCodes({ encounterId: "visit-1042" });
  expect(calls).toBe(3);
});

test("a hosted model is offered the WHO ICD-10 table's codes for the note's words to pick from", async () => {
  let offered: { code: string; label: string }[] | undefined;
  const { api } = await world({ ...stubModels, suggestCodes: input => { offered = input.candidates; return stubModels.suggestCodes(input); } });
  await api.note.save({ encounterId: "visit-1042", expectedRevision: 0, sentences: noteFor(EMPTY_CLAIM) });
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
