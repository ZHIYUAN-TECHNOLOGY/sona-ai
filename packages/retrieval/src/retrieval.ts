import { searchInputSchema, type RetrievalHit } from "@sona-ai/api/contracts";
import { chunks, documents } from "@sona-ai/db/schema/index";
import { eq, sql } from "drizzle-orm";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core/async";
import type { z } from "zod";

/** Any drizzle Postgres database: Neon in staging, PGlite in tests. */
type AnyDb = PgAsyncDatabase<any, any>;

/**
 * Text to 768-dim vectors (EmbeddingGemma-300M on Workers AI, packages/api/src/workers-models.ts); batched so
 * ingestion is one call per document. A question and a passage are embedded with different prompts, so callers say which.
 */
export type Embedder = (texts: string[], as: "query" | "document") => Promise<number[][]>;
/** Relevance score per passage for the query, higher is better (bge-reranker-v2-m3 in box ②). */
export type Reranker = (query: string, passages: string[]) => Promise<number[]>;

export type LibraryDocument = { id: string; hospitalId: string | null; title: string; source: string; year: number; license?: string | null; uploadedBy?: string | null; ownerId?: string | null; kind?: "text" | "pdf" | "pubmed" };

const DIMS = 768;

/** Deterministic hashed bag-of-words embedder for tests and offline evals. Never a network model. */
export const stubEmbedder: Embedder = async texts => texts.map(text => {
  const v = new Array<number>(DIMS).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let h = 2166136261; // FNV-1a
    for (const c of word) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    v[(h >>> 0) % DIMS]! += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map(x => x / norm);
});

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";

// ponytail: a numbered heading is a short capitalised line with no closing punctuation, so "1. Give 500 mg." stays body text; swap for layout-aware extraction (OpenMed) on real PDFs.
const HEADING = /^#{1,6}\s+(.+?)\s*#*$|^(\d+(?:\.\d+)*\.?\s+[A-Z][^.!?:;]{0,80})$/;

/** Cuts text into sections at markdown or numbered headings; text before the first heading is "Introduction". */
function sections(text: string) {
  const out: { section: string; text: string }[] = [];
  let current = { section: "Introduction", lines: [] as string[] };
  const flush = () => { const body = current.lines.join("\n").trim(); if (body) out.push({ section: current.section, text: body }); };
  for (const line of text.split("\n")) {
    const heading = line.trim().match(HEADING);
    if (heading) { flush(); current = { section: (heading[1] ?? heading[2])!.trim(), lines: [] }; } else current.lines.push(line);
  }
  flush();
  return out;
}

// Index each chunk with its document title and heading, so a section that never names its topic is still found.
const indexedText = (title: string, section: string, text: string) => `${title}\n${section}\n${text}`;

/**
 * Stores a document and one chunk per section, each tagged and embedded; re-ingesting replaces its chunks. Returns the section count.
 * When the embedder fails, the sections are stored without vectors: keywords still find them, and `reindex` adds the vectors.
 */
export async function ingest(db: AnyDb, doc: LibraryDocument, text: string, embedder: Embedder): Promise<number> {
  const parts = sections(text);
  const indexed = parts.map(p => indexedText(doc.title, p.section, p.text));
  const vectors = await embedder(indexed, "document").catch(() => null);
  // ponytail: not one transaction (neon-http has none), so a search mid-re-ingest can see the document without chunks; use db.batch or a pooled driver if re-ingests go live.
  await db.insert(documents).values(doc).onConflictDoUpdate({ target: documents.id, set: { ...doc, id: undefined } });
  await db.delete(chunks).where(eq(chunks.documentId, doc.id));
  if (!parts.length) return 0;
  const seen = new Map<string, number>();
  await db.insert(chunks).values(parts.map((p, i) => {
    const s = slug(p.section), n = (seen.get(s) ?? 0) + 1;
    seen.set(s, n);
    const sourceId = `${doc.id}#${n > 1 ? `${s}-${n}` : s}`;
    return {
      id: sourceId, documentId: doc.id, hospitalId: doc.hospitalId, sourceId, section: p.section, text: p.text,
      embedding: vectors?.[i] ?? null, search: sql`to_tsvector('english', ${indexed[i]!})`,
    };
  }));
  return parts.length;
}

const REINDEX_BATCH = 100; // Workers AI embeds up to 100 texts a call

/**
 * Re-embeds every chunk of the shared library and one hospital's sources, from the same text `ingest` embeds. Run it
 * after the embedder changes (vectors from two models do not compare) or to fill vectors a failed embedding left out.
 * One embedding call and one update per 100 chunks; a failure stops it, and running it again redoes it all. Returns the chunk count.
 */
export async function reindex(db: AnyDb, embedder: Embedder, hospitalId: string): Promise<number> {
  const rows = (await db.execute(sql`select c.id, d.title, c.section, c.text from chunks c join documents d on d.id = c.document_id
    where c.hospital_id is null or c.hospital_id = ${hospitalId} order by c.id`)).rows as { id: string; title: string; section: string; text: string }[];
  for (let i = 0; i < rows.length; i += REINDEX_BATCH) {
    const batch = rows.slice(i, i + REINDEX_BATCH);
    const vectors = await embedder(batch.map(r => indexedText(r.title, r.section, r.text)), "document");
    const values = sql.join(batch.map((r, j) => sql`(${r.id}, ${JSON.stringify(vectors[j])})`), sql`, `);
    await db.execute(sql`update chunks set embedding = v.embedding::vector from (values ${values}) as v(id, embedding) where chunks.id = v.id`);
  }
  return rows.length;
}

const RRF_K = 60;
const POOL = 50;
const RERANK_POOL = 20; // the reranker sees the fused top 20 (the largest k)

type Row = { id: string; document_id: string; source_id: string; section: string; text: string; source: string; year: number };

/**
 * How a search was really made, carried on its hits: `retrieval` is "keywords" when the embedder failed and keywords
 * answered alone; `ranked` is false when a reranker was given and failed (the fused order stands), true when it scored
 * the hits, and absent when none was given. The passages are real either way; a caller that shows them can say which.
 */
export type SearchReport = { retrieval: "hybrid" | "keywords"; ranked?: boolean };

/**
 * Hybrid search: full-text and cosine vector search fused by reciprocal rank, then optionally reranked. When the
 * embedder fails or is slow, keywords answer alone; a stand-in vector from another model would rank at random. When
 * the reranker fails, the fused order stands. Neither fails the search, and both are reported (SearchReport).
 */
export async function search(db: AnyDb, input: z.input<typeof searchInputSchema>, embedder: Embedder, reranker?: Reranker): Promise<RetrievalHit[] & SearchReport> {
  const { query, hospitalId, userId, k } = searchInputSchema.parse(input);
  const cols = sql`c.id, c.document_id, c.source_id, c.section, c.text, d.source, d.year`;
  // ponytail: scoped in the query, not by row-level security; add RLS policies when the Worker sets a per-request hospital.
  // A doctor's private sources are searched for that doctor only; with no caller, only shared ones.
  const from = sql`chunks c join documents d on d.id = c.document_id where (c.hospital_id is null or c.hospital_id = ${hospitalId}) and (d.owner_id is null or d.owner_id = ${userId ?? null})`;
  // OR the query's lexemes so a natural question matches any of its terms.
  const tsq = sql`replace(plainto_tsquery('english', ${query})::text, '&', '|')::tsquery`;
  // The question is embedded while the keyword half runs, so the model's round trip is not added to it.
  const [qv, keyword] = await Promise.all([
    embedder([query], "query").then(([v]) => v, () => undefined),
    db.execute(sql`select ${cols} from ${from} and c.search @@ ${tsq} order by ts_rank(c.search, ${tsq}) desc limit ${POOL}`),
  ]);
  const vector = qv ? await db.execute(sql`select ${cols} from ${from} and c.embedding is not null order by c.embedding <=> ${JSON.stringify(qv)}::vector limit ${POOL}`) : { rows: [] };

  const fused = new Map<string, { row: Row; score: number }>();
  for (const list of [keyword.rows, vector.rows] as Row[][]) {
    list.forEach((row, rank) => {
      const entry = fused.get(row.id) ?? { row, score: 0 };
      entry.score += 1 / (RRF_K + rank + 1);
      fused.set(row.id, entry);
    });
  }
  let ranked = [...fused.values()].sort((a, b) => b.score - a.score), reranked: boolean | undefined;
  if (reranker && ranked.length) {
    ranked = ranked.slice(0, RERANK_POOL);
    const scores = await reranker(query, ranked.map(r => r.row.text)).catch(() => undefined);
    reranked = scores?.length === ranked.length;
    if (reranked) ranked = ranked.map((r, i) => ({ ...r, score: scores![i]! })).sort((a, b) => b.score - a.score);
  }
  const hits = ranked.slice(0, k).map(({ row, score }) => ({
    chunkId: row.id, documentId: row.document_id, sourceId: row.source_id, text: row.text, score,
    tags: { source: row.source, year: row.year, section: row.section },
  }));
  // ponytail: the report rides on the array (it does not survive JSON), because `Library.search` is typed as hits alone
  // in packages/api's context; give it a `{ hits, ...report }` result when that type can change with its callers.
  return Object.assign(hits, { retrieval: qv ? "hybrid" as const : "keywords" as const, ...reranked !== undefined && { ranked: reranked } });
}
