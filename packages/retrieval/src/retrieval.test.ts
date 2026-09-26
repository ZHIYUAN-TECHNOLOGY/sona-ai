import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { retrievalHitSchema } from "@sona-ai/api/contracts";
import { createTestDb } from "@sona-ai/db/testing";
import { ingest, search, stubEmbedder } from "./retrieval";

const guideline = { id: "ats-2019", hospitalId: null, title: "CAP guideline (synthetic)", source: "ATS/IDSA", year: 2019 };
const guidelineText = `# Corticosteroids
Do not routinely use corticosteroids in non-severe community-acquired pneumonia.

# Macrolides
Azithromycin 500 mg once daily for three days.`;

test("every hit names its source, year and section with a stable source ID", async () => {
  const db = await createTestDb();
  await ingest(db, guideline, guidelineText, stubEmbedder);
  const hits = await search(db, { query: "azithromycin dose", hospitalId: "h1" }, stubEmbedder);
  expect(hits[0]).toMatchObject({ documentId: "ats-2019", sourceId: "ats-2019#macrolides", tags: { source: "ATS/IDSA", year: 2019, section: "Macrolides" } });
  expect(hits[0]!.text).toContain("Azithromycin 500 mg");
  for (const hit of hits) expect(retrievalHitSchema.parse(hit)).toEqual(hit);
});

test("numbered sections are cut and tagged like markdown headings", async () => {
  const db = await createTestDb();
  const cpg = { id: "moh-cpg", hospitalId: null, title: "CPG (synthetic)", source: "MOH Malaysia", year: 2024 };
  await ingest(db, cpg, "1. Scope\nAdults with pneumonia.\n\n2.1 Severity Assessment\nScore CURB-65 on admission.\n1. Confusion counts one point.", stubEmbedder);
  const hits = await search(db, { query: "CURB-65 severity", hospitalId: "h1" }, stubEmbedder);
  expect(hits.map(h => [h.sourceId, h.tags.section])).toEqual([["moh-cpg#2-1-severity-assessment", "2.1 Severity Assessment"], ["moh-cpg#1-scope", "1. Scope"]]);
  expect(hits[0]!.text).toBe("Score CURB-65 on admission.\n1. Confusion counts one point.");
});

test("a heading repeated within a document still gets its own source ID", async () => {
  const db = await createTestDb();
  await ingest(db, guideline, "# Dosing\nAdults 500 mg.\n# Dosing\nChildren 10 mg/kg.", stubEmbedder);
  const hits = await search(db, { query: "dosing", hospitalId: "h1" }, stubEmbedder);
  expect(hits.map(h => h.sourceId).sort()).toEqual(["ats-2019#dosing", "ats-2019#dosing-2"]);
});

/** Hand-set vectors: the query sits on axis 0; each part's cosine distance to it is chosen. */
const axes = (weights: Record<number, number>) => Array.from({ length: 768 }, (_, i) => weights[i] ?? 0);
const workedVectors: Record<string, number[]> = {
  "Part A": axes({ 1: 1 }), // distance 1: last in vector search
  "Part B": axes({ 0: 1 }), // distance 0: first in vector search
  "Part C": axes({ 0: 0.8, 1: 0.6 }), // distance 0.2: second
  "Filler": axes({ 0: 0.5, 2: Math.sqrt(0.75) }), // distance 0.5: pushes A down the vector list
};
const workedEmbedder = async (texts: string[]) => texts.map(t => Object.entries(workedVectors).find(([label]) => t.includes(label))?.[1] ?? axes({ 0: 1 }));

test("a chunk ranked well by both keywords and vectors outranks one that wins only one of them", async () => {
  const db = await createTestDb();
  await ingest(db, guideline, `# Part A
Corticosteroids in pneumonia: corticosteroids for pneumonia, corticosteroids again.
# Part B
Adjunctive anti-inflammatory therapy in chest infection.
# Part C
Corticosteroids for pneumonia.
# Filler one
Hand hygiene on the ward.
# Filler two
Bed allocation rules.
# Filler three
Porter request times.`, workedEmbedder);
  // Keyword ranks: A 1, C 2. Vector ranks: B 1, C 2, fillers 3-5, A 6.
  // RRF (k=60): C = 1/62 + 1/62 = 0.03226 > A = 1/61 + 1/66 = 0.03155 > B = 1/61 = 0.01639.
  const hits = await search(db, { query: "corticosteroids pneumonia", hospitalId: "h1" }, workedEmbedder);
  expect(hits.slice(0, 3).map(h => h.sourceId)).toEqual(["ats-2019#part-c", "ats-2019#part-a", "ats-2019#part-b"]);
  expect(hits[0]!.score).toBeCloseTo(2 / 62, 6);
});

test("a reranker reorders the fused candidates before the top k are taken", async () => {
  const db = await createTestDb();
  await ingest(db, guideline, guidelineText, stubEmbedder);
  const prefersSteroids = async (_q: string, passages: string[]) => passages.map(p => (p.includes("corticosteroids") ? 0.9 : 0.1));
  const hits = await search(db, { query: "azithromycin dose", hospitalId: "h1", k: 1 }, stubEmbedder, prefersSteroids);
  expect(hits.map(h => [h.sourceId, h.score])).toEqual([["ats-2019#corticosteroids", 0.9]]);
});

test("a search input outside the contract is rejected", async () => {
  const db = await createTestDb();
  await expect(search(db, { query: "  ", hospitalId: "h1" }, stubEmbedder)).rejects.toThrow();
  await expect(search(db, { query: "pneumonia", hospitalId: "h1", k: 21 }, stubEmbedder)).rejects.toThrow();
  await expect(search(db, { query: "pneumonia", hospitalId: "" }, stubEmbedder)).rejects.toThrow();
});

test("re-ingesting a document replaces its chunks", async () => {
  const db = await createTestDb();
  await ingest(db, guideline, guidelineText, stubEmbedder);
  await ingest(db, { ...guideline, year: 2025 }, "# Macrolides\nClarithromycin twice daily.", stubEmbedder);
  const hits = await search(db, { query: "corticosteroids azithromycin clarithromycin", hospitalId: "h1", k: 20 }, stubEmbedder);
  expect(hits.map(h => [h.sourceId, h.tags.year, h.text])).toEqual([["ats-2019#macrolides", 2025, "Clarithromycin twice daily."]]);
});

test("a search returns the shared library and the caller's hospital, never another hospital's documents", async () => {
  const db = await createTestDb();
  await ingest(db, guideline, guidelineText, stubEmbedder);
  const policy = (hospitalId: string) => ({ id: `${hospitalId}-abx`, hospitalId, title: "Antibiotic policy", source: `${hospitalId} pharmacy`, year: 2026 });
  await ingest(db, policy("h1"), "# Azithromycin\nAzithromycin dose here is 500 mg on day one.", stubEmbedder);
  await ingest(db, policy("h2"), "# Azithromycin\nAzithromycin dose here is 250 mg daily.", stubEmbedder);
  const hits = await search(db, { query: "azithromycin dose", hospitalId: "h1", k: 20 }, stubEmbedder);
  expect(new Set(hits.map(h => h.documentId))).toEqual(new Set(["ats-2019", "h1-abx"]));
});

test("under the database's own rules, a restricted role reads the shared library and its hospital's chunks only", async () => {
  const db = await createTestDb();
  await ingest(db, guideline, guidelineText, stubEmbedder);
  await ingest(db, { id: "h1-abx", hospitalId: "h1", title: "Antibiotic policy", source: "h1 pharmacy", year: 2026 }, "# Azithromycin\n500 mg on day one.", stubEmbedder);
  await ingest(db, { id: "h2-abx", hospitalId: "h2", title: "Antibiotic policy", source: "h2 pharmacy", year: 2026 }, "# Azithromycin\n250 mg daily.", stubEmbedder);
  await db.execute(sql`create role reader nologin`);
  await db.execute(sql`grant select on chunks, documents to reader`);
  const seen = await db.transaction(async tx => {
    await tx.execute(sql`set local role reader`);
    await tx.execute(sql`select set_config('app.hospital_id', 'h1', true)`);
    const rows = await tx.execute(sql`select distinct document_id from chunks order by document_id`);
    return rows.rows.map(r => r.document_id);
  });
  expect(seen).toEqual(["ats-2019", "h1-abx"]);
});
