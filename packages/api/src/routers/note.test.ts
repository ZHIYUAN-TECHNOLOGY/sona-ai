import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { DEMO_HOSPITAL } from "@sona-ai/db/demo";
import { hospitalMembers, hospitals, provenance } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { MANGLISH_CONSULTATION } from "../fixtures/manglish-consultation";
import { stubModels, type Models } from "../models";
import { appRouter } from "./index";

/** The scribe's route: a draft of the visit's note from its consultation, never saved by itself. */
const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

async function world(models?: Models) {
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T09:00:00+08:00"));
  await addClinician(db, "dr-aisyah");
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), models } });
  return { db, api: as("dr-aisyah"), as };
}
const lines = MANGLISH_CONSULTATION.map(text => ({ text }));

test("without a model the draft is the captured words, labelled fixture, logged in provenance and not saved", async () => {
  const { db, api } = await world();
  const draft = await api.note.draft({ encounterId: "visit-1042", lines });
  expect(draft.source).toBe("fixture");
  expect(draft.sections.subjective).toBe(MANGLISH_CONSULTATION.join("\n"));
  expect([draft.sections.objective, draft.sections.assessment, draft.sections.plan]).toEqual(["", "", ""]);
  expect(draft.turns.every(t => !t.sure && !t.speaker)).toBe(true);
  const [log] = await db.select().from(provenance).where(eq(provenance.kind, "note-draft"));
  expect([log!.encounterId, log!.model]).toEqual(["visit-1042", "fixture"]);
  expect((await api.note.get({ encounterId: "visit-1042" })).revision).toBe(0);
});

test("Gemma's draft comes back with its model and its counted drops, and provenance records the model", async () => {
  const models: Models = { ...stubModels, draftNote: async ({ lines }) => ({
    sections: { subjective: "Cough for 5 days.", objective: "", assessment: "", plan: "" },
    turns: lines.map(l => ({ text: l.text, speaker: "patient" as const, sure: true })), dropped: 2, source: "model", model: "gemma-4-26b-a4b",
  }) };
  const { db, api } = await world(models);
  const draft = await api.note.draft({ encounterId: "visit-1042", lines: [{ text: "Batuk dah lima hari.", speaker: "patient" }] });
  expect(draft).toMatchObject({ source: "model", model: "gemma-4-26b-a4b", dropped: 2, sections: { subjective: "Cough for 5 days." } });
  const [log] = await db.select().from(provenance).where(eq(provenance.kind, "note-draft"));
  expect(log!.model).toBe("gemma-4-26b-a4b");
  expect(log!.output).toMatchObject({ dropped: 2 });
});

test("only a doctor drafts, only in their own hospital, and only a consultation Gemma can read at once", async () => {
  const { db, api, as } = await world();
  await addClinician(db, "nurse-lee", DEMO_HOSPITAL, "nurse");
  expect((await as("nurse-lee").note.draft({ encounterId: "visit-1042", lines }).catch(e => e)).code).toBe("FORBIDDEN");
  await db.insert(hospitals).values({ id: "other", name: "Other Hospital (synthetic)" });
  await db.insert(hospitalMembers).values({ userId: "dr-other", hospitalId: "other" });
  expect((await as("dr-other").note.draft({ encounterId: "visit-1042", lines }).catch(e => e)).code).toBe("NOT_FOUND");
  const long = Array.from({ length: 11 }, () => ({ text: "Batuk. ".repeat(560) }));
  expect((await api.note.draft({ encounterId: "visit-1042", lines: long }).catch(e => e)).code).toBe("BAD_REQUEST");
  expect((await api.note.draft({ encounterId: "visit-1042", lines: [] }).catch(e => e)).code).toBe("BAD_REQUEST");
});
