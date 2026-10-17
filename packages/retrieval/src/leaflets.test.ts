import { createRouterClient } from "@orpc/server";
import { chatModels, type Chat } from "@sona-ai/api/chat-models";
import { stubModels } from "@sona-ai/api/models";
import { appRouter } from "@sona-ai/api/routers/index";
import { chunks, documents, hospitalMembers, hospitals } from "@sona-ai/db/schema/clinical";
import { DEMO_HOSPITAL, seedDemo, seedLeaflets } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { ingest, reindex, search, stubEmbedder, type Embedder, type Reranker } from "./retrieval";

/**
 * The hospital's patient leaflets in a real library: what the seed stores, and that a patient's search reads her own
 * hospital's leaflets and nothing else, through the route too (care.ask with the real search behind it).
 */
const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
}) as never;
const down: Embedder = async () => { throw new Error("embedder down"); };

/** The demo hospital with its leaflets seeded, and everything a patient must never read beside them, all about pneumonia. */
async function world(embedder: Embedder = stubEmbedder, chat: Chat = async () => undefined) {
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T09:00:00+08:00"));
  await addClinician(db, "dr-aisyah");
  await db.insert(hospitals).values({ id: "other", name: "Other Hospital (synthetic)" });
  await db.insert(hospitalMembers).values({ userId: "dr-other", hospitalId: "other" });
  const store = (doc: Parameters<typeof ingest>[1], text: string) => ingest(db, doc, text, embedder);
  const seeded = await seedLeaflets(store);
  await store({ id: "other:leaflet:pneumonia:en", hospitalId: "other", title: "Other hospital's pneumonia leaflet", source: "Patient leaflet (English)", year: 2026, kind: "leaflet" }, "# Community-acquired pneumonia\nOTHER-HOSPITAL pneumonia advice.");
  await store({ id: "shared-leaflet", hospitalId: null, title: "Nobody's pneumonia leaflet", source: "Patient leaflet (English)", year: 2026, kind: "leaflet" }, "# Community-acquired pneumonia\nSHARED-LIBRARY pneumonia advice.");
  await store({ id: "ats-2019", hospitalId: null, title: "CAP guideline (synthetic)", source: "ATS/IDSA", year: 2019 }, "# Pneumonia\nSTAFF-GUIDELINE: corticosteroids in severe community-acquired pneumonia.");
  const library = { ingest: store, search: (input: Parameters<typeof search>[1]) => search(db, input, embedder), reindex: (hospitalId: string) => reindex(db, embedder, hospitalId) };
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), library, models: { ...stubModels, ...chatModels(chat, "gemma-test", stubModels) } } });
  const doctor = as("dr-aisyah");
  // A guideline shared with the hospital, a doctor's own source, and a source that only calls itself a leaflet.
  await doctor.library.add({ requestId: "ward-cap", scope: "hospital", title: "Ward CAP protocol (synthetic)", source: "Hospital pharmacy", year: 2026, text: "# Pneumonia\nSTAFF-PROTOCOL: amoxicillin 1 g three times daily for pneumonia." });
  await doctor.library.add({ requestId: "my-notes", scope: "me", title: "My pneumonia notes (synthetic)", source: "Dr Aisyah", year: 2026, text: "# Pneumonia\nDOCTOR-PRIVATE pneumonia notes." });
  await doctor.library.add({ requestId: "leaflet:fake:en", scope: "hospital", title: "Patient leaflet: pneumonia", source: "Patient leaflet (English)", year: 2026, text: "# Community-acquired pneumonia\nSTAFF-NAMED-LEAFLET pneumonia text." });
  const amelia = as("amelia-account");
  await amelia.care.join({ code: (await doctor.care.code({ encounterId: "visit-1042" })).code });
  return { db, seeded, doctor, amelia, as };
}

test("the seed stores each of the hospital's leaflets once per language, as a library document of kind leaflet, word for word and rerun-safe", async () => {
  const { db, seeded } = await world();
  const mine = () => db.select().from(documents).where(eq(documents.hospitalId, DEMO_HOSPITAL));
  const leaflets = (await mine()).filter(d => d.kind === "leaflet");
  expect([seeded, leaflets.length]).toEqual([21, 21]);
  expect(leaflets.every(d => d.ownerId === null && d.uploadedBy === null && d.source.startsWith("Patient leaflet ("))).toBe(true);
  expect(leaflets.filter(d => d.id.includes(":pneumonia:")).map(d => [d.id, d.title, d.source]).sort()).toEqual([
    ["demo:leaflet:pneumonia:en", "Chest infection", "Patient leaflet (English)"],
    ["demo:leaflet:pneumonia:ms", "Jangkitan paru-paru", "Patient leaflet (Bahasa Melayu)"],
    ["demo:leaflet:pneumonia:zh", "肺部感染", "Patient leaflet (Chinese)"],
  ]);
  const [chunk] = await db.select().from(chunks).where(eq(chunks.documentId, "demo:leaflet:pneumonia:en"));
  expect(chunk).toMatchObject({ hospitalId: DEMO_HOSPITAL, section: "Community-acquired pneumonia", text: "You were treated for a chest infection. Finish your antibiotic course as prescribed. Come back straight away if breathing gets harder, your lips turn blue, or the fever returns." });
  await seedLeaflets((doc, text) => ingest(db, doc, text, stubEmbedder));
  expect((await mine()).filter(d => d.kind === "leaflet")).toHaveLength(21);
});

test("a patient's search reads her own hospital's leaflets only: never another hospital's, the shared library, a guideline, a doctor's own source, or a source merely named a leaflet", async () => {
  const { db } = await world();
  for (const embedder of [stubEmbedder, down]) {
    const hits = await search(db, { query: "pneumonia chest infection amoxicillin corticosteroids advice notes", hospitalId: DEMO_HOSPITAL, patient: true, k: 20 }, embedder);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(h => h.documentId.startsWith("demo:leaflet:"))).toBe(true);
    expect(hits.map(h => h.text).join("\n")).not.toMatch(/OTHER-HOSPITAL|SHARED-LIBRARY|STAFF-|DOCTOR-PRIVATE/);
    expect(hits[0]!.tags).toMatchObject({ section: "Community-acquired pneumonia", title: expect.stringMatching(/Chest infection|Jangkitan paru-paru|肺部感染/) });
    // The patient's account passed as a doctor's opens nothing more (the route never passes one).
    const asUser = await search(db, { query: "pneumonia notes", hospitalId: DEMO_HOSPITAL, userId: "dr-aisyah", patient: true, k: 20 }, embedder);
    expect(asUser.every(h => h.documentId.startsWith("demo:leaflet:"))).toBe(true);
    // The other hospital's patients read theirs, and only theirs.
    expect((await search(db, { query: "pneumonia", hospitalId: "other", patient: true, k: 20 }, embedder)).map(h => h.documentId)).toEqual(["other:leaflet:pneumonia:en"]);
  }
});

test("a patient's search is never reranked, and the embedder being down leaves keywords to find the leaflet", async () => {
  const { db } = await world(down);
  let reranked = 0;
  const reranker: Reranker = async (_, passages) => { reranked++; return passages.map(() => 0); };
  const hits = await search(db, { query: "What should I watch for while recovering from pneumonia?", hospitalId: DEMO_HOSPITAL, patient: true, k: 9 }, down, reranker);
  expect(reranked).toBe(0);
  expect(hits.retrieval).toBe("keywords");
  expect(hits.map(h => h.documentId).sort()).toEqual(["demo:leaflet:pneumonia:en", "demo:leaflet:pneumonia:ms", "demo:leaflet:pneumonia:zh"]);
});

test("the clinicians' library is as it was: leaflets are not in their evidence search or their list, cannot be removed there, and no upload can take a leaflet's place", async () => {
  const { db, doctor } = await world();
  const staff = await search(db, { query: "pneumonia chest infection antibiotic course", hospitalId: DEMO_HOSPITAL, userId: "dr-aisyah", k: 20 }, stubEmbedder);
  expect(staff.length).toBeGreaterThan(0);
  expect(staff.some(h => h.documentId.includes(":leaflet:pneumonia") || h.documentId === "shared-leaflet")).toBe(false);
  expect((await doctor.library.list()).map(d => d.title).sort()).toEqual(["My pneumonia notes (synthetic)", "Patient leaflet: pneumonia", "Ward CAP protocol (synthetic)"]);
  await expect(doctor.library.remove({ documentId: "demo:leaflet:pneumonia:en" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  // An upload whose request id spells a leaflet's id is refused: the leaflet is not the uploader's document.
  await expect(doctor.library.add({ requestId: "leaflet:pneumonia:en", scope: "hospital", title: "Mine now", source: "x", year: 2026, text: "# Pneumonia\nSTAFF-OVERWRITE." })).rejects.toMatchObject({ code: "CONFLICT" });
  const [kept] = await db.select().from(documents).where(eq(documents.id, "demo:leaflet:pneumonia:en"));
  expect(kept).toMatchObject({ title: "Chest infection", kind: "leaflet" });
});

test("care.ask with the real library: her hospital's pneumonia leaflet reaches Gemma under the leaflets heading and is named as the source; no staff or other hospital's text does", async () => {
  const prompts: string[] = [];
  const chat: Chat = async system => { prompts.push(system); return { answer: "The hospital's leaflet says to come back if breathing gets harder.", grounded: false, urgent: false, cites: [1] }; };
  const { amelia } = await world(stubEmbedder, chat);
  const answer = await amelia.care.ask({ question: "What should I watch for while recovering from pneumonia?" });
  const leaflets = prompts[0]!.slice(prompts[0]!.indexOf("Hospital's general leaflets"));
  expect(leaflets).toContain("[1] Chest infection: You were treated for a chest infection. Finish your antibiotic course as prescribed.");
  expect(prompts[0]).not.toMatch(/OTHER-HOSPITAL|SHARED-LIBRARY|STAFF-|DOCTOR-PRIVATE/);
  // Each leaflet once (never its three languages as three passages).
  expect(leaflets.match(/^\[\d\]/gm)!.length).toBeLessThanOrEqual(3);
  expect(leaflets).not.toMatch(/Jangkitan paru-paru|肺部感染/);
  expect(answer).toMatchObject({ grounded: false, sources: [{ title: "Chest infection", kind: "leaflet" }], source: "model" });
});
