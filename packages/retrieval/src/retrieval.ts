import { searchInputSchema, type RetrievalHit } from "@sona-ai/api/contracts";
import { chunks, documents } from "@sona-ai/db/schema/index";
import { eq, sql } from "drizzle-orm";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core/async";
import type { z } from "zod";

/** Any drizzle Postgres database: Neon in staging, PGlite in tests. */
type AnyDb = PgAsyncDatabase<any, any>;

/** Text to 768-dim vectors (EmbeddingGemma-300M in box ②); batched so ingestion is one call per document. */
export type Embedder = (texts: string[]) => Promise<number[][]>;
/** Relevance score per passage for the query, higher is better (bge-reranker-v2-m3 in box ②). */
export type Reranker = (query: string, passages: string[]) => Promise<number[]>;

export type LibraryDocument = { id: string; hospitalId: string | null; title: string; source: string; year: number; license?: string | null; uploadedBy?: string | null };

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

/** Stores a document and one chunk per section, each tagged and embedded; re-ingesting replaces its chunks. */
export async function ingest(db: AnyDb, doc: LibraryDocument, text: string, embedder: Embedder) {
  const parts = sections(text);
  // Index each chunk with its document title and heading, so a section that never names its topic is still found.
  const indexed = parts.map(p => `${doc.title}\n${p.section}\n${p.text}`);
  const vectors = await embedder(indexed);
  // ponytail: not one transaction (neon-http has none), so a search mid-re-ingest can see the document without chunks; use db.batch or a pooled driver if re-ingests go live.
  await db.insert(documents).values(doc).onConflictDoUpdate({ target: documents.id, set: { ...doc, id: undefined } });
  await db.delete(chunks).where(eq(chunks.documentId, doc.id));
  if (!parts.length) return;
  const seen = new Map<string, number>();
  await db.insert(chunks).values(parts.map((p, i) => {
    const s = slug(p.section), n = (seen.get(s) ?? 0) + 1;
    seen.set(s, n);
    const sourceId = `${doc.id}#${n > 1 ? `${s}-${n}` : s}`;
    return {
      id: sourceId, documentId: doc.id, hospitalId: doc.hospitalId, sourceId, section: p.section, text: p.text,
      embedding: vectors[i]!, search: sql`to_tsvector('english', ${indexed[i]!})`,
    };
  }));
}

const RRF_K = 60;
const POOL = 50;
const RERANK_POOL = 20; // the reranker sees the fused top 20 (the largest k)

type Row = { id: string; document_id: string; source_id: string; section: string; text: string; source: string; year: number };

/** Hybrid search: full-text and cosine vector search fused by reciprocal rank, then optionally reranked. */
export async function search(db: AnyDb, input: z.input<typeof searchInputSchema>, embedder: Embedder, reranker?: Reranker): Promise<RetrievalHit[]> {
  const { query, hospitalId, k } = searchInputSchema.parse(input);
  const [qv] = await embedder([query]);
  const cols = sql`c.id, c.document_id, c.source_id, c.section, c.text, d.source, d.year`;
  // ponytail: scoped in the query, not by row-level security; add RLS policies when the Worker sets a per-request hospital.
  const from = sql`chunks c join documents d on d.id = c.document_id where (c.hospital_id is null or c.hospital_id = ${hospitalId})`;
  // OR the query's lexemes so a natural question matches any of its terms.
  const tsq = sql`replace(plainto_tsquery('english', ${query})::text, '&', '|')::tsquery`;
  const keyword = await db.execute(sql`select ${cols} from ${from} and c.search @@ ${tsq} order by ts_rank(c.search, ${tsq}) desc limit ${POOL}`);
  const vector = await db.execute(sql`select ${cols} from ${from} and c.embedding is not null order by c.embedding <=> ${JSON.stringify(qv)}::vector limit ${POOL}`);

  const fused = new Map<string, { row: Row; score: number }>();
  for (const list of [keyword.rows, vector.rows] as Row[][]) {
    list.forEach((row, rank) => {
      const entry = fused.get(row.id) ?? { row, score: 0 };
      entry.score += 1 / (RRF_K + rank + 1);
      fused.set(row.id, entry);
    });
  }
  let ranked = [...fused.values()].sort((a, b) => b.score - a.score);
  if (reranker) {
    ranked = ranked.slice(0, RERANK_POOL);
    const scores = await reranker(query, ranked.map(r => r.row.text));
    ranked = ranked.map((r, i) => ({ ...r, score: scores[i]! })).sort((a, b) => b.score - a.score);
  }
  return ranked.slice(0, k).map(({ row, score }) => ({
    chunkId: row.id, documentId: row.document_id, sourceId: row.source_id, text: row.text, score,
    tags: { source: row.source, year: row.year, section: row.section },
  }));
}
