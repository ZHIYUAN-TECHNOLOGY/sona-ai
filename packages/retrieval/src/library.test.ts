import { createRouterClient } from "@orpc/server";
import { appRouter } from "@sona-ai/api/routers/index";
import { hospitalMembers, hospitals, provenance } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { ingest, search, stubEmbedder } from "./retrieval";

/** A doctor's own hospital library through the API, with the real retrieval functions behind it (as the Worker wires them). */
const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
}) as never;

/** PubMed unreachable, so every answer rests on the library alone. */
const offline = (async () => { throw new Error("network unreachable"); }) as unknown as typeof fetch;

async function signedIn() {
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T09:00:00+08:00"));
  await db.insert(hospitals).values({ id: "other", name: "Other Hospital (synthetic)" });
  await db.insert(hospitalMembers).values({ userId: "dr-other", hospitalId: "other" });
  const library = { ingest: (doc: Parameters<typeof ingest>[1], text: string) => ingest(db, doc, text, stubEmbedder), search: (input: Parameters<typeof search>[1]) => search(db, input, stubEmbedder) };
  const as = (id: string | null) => createRouterClient(appRouter, { context: { db, session: id ? user(id) : null, library, fetch: offline } });
  return { db, as, api: as("dr-aisyah") };
}

const protocol = {
  requestId: "req-1", title: "Ward CAP protocol (synthetic)", source: "Hospital pharmacy", year: 2026,
  text: "# Steroids\nNo hydrocortisone in non-severe pneumonia on this ward.\n\n# Antibiotics\nAmoxicillin 1 g three times daily for five days.",
};

test("a doctor adds a source to their hospital's library and it is listed there, never for another hospital", async () => {
  const { api, as } = await signedIn();
  const added = await api.library.add(protocol);
  expect(added).toMatchObject({ title: protocol.title, source: "Hospital pharmacy", year: 2026 });
  expect((await api.library.list()).map(d => [d.id, d.title, d.uploadedBy])).toEqual([[added.id, protocol.title, "dr-aisyah"]]);
  expect(await as("dr-other").library.list()).toEqual([]);
});

test("a retried add replaces the same document, and only its own hospital can remove it", async () => {
  const { api, as } = await signedIn();
  const first = await api.library.add(protocol);
  await api.library.add({ ...protocol, title: "Ward CAP protocol v2 (synthetic)" });
  expect((await api.library.list()).map(d => [d.id, d.title])).toEqual([[first.id, "Ward CAP protocol v2 (synthetic)"]]);
  await expect(as("dr-other").library.remove({ documentId: first.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await api.library.remove({ documentId: first.id })).toEqual({ id: first.id });
  expect(await api.library.list()).toEqual([]);
});

test("the evidence answer cites the hospital's own passages beside PubMed, without grading them, and stops once removed", async () => {
  const { api, db } = await signedIn();
  const doc = await api.library.add(protocol);
  const ask = () => api.evidence.ask({ encounterId: "visit-1086", question: "What amoxicillin dose does the ward use?" });
  const r = await ask();
  expect(r.passages[0]).toMatchObject({ id: `${doc.id}#antibiotics`, documentId: doc.id, title: protocol.title, section: "Antibiotics", source: "Hospital pharmacy", year: 2026 });
  expect(r.passages[0]!.text).toContain("Amoxicillin 1 g");
  expect(r.passages.length).toBeLessThanOrEqual(3);
  // PubMed is down here, so no study graded; an uploaded passage does not raise the certainty.
  expect(r).toMatchObject({ pubmed: "unavailable", studies: [], grade: { certainty: "No evidence found" } });
  const [log] = await db.select().from(provenance);
  expect(log!.sourceIds).toContain(`${doc.id}#antibiotics`);
  await api.library.remove({ documentId: doc.id });
  expect((await ask()).passages).toEqual([]);
});

test("the library needs a login", async () => {
  const { as } = await signedIn();
  await expect(as(null).library.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(as(null).library.add(protocol)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});
