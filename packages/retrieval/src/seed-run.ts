import { createDb } from "@sona-ai/db";
import { seedLeaflets } from "@sona-ai/db/seed";

import { ingest, type Embedder } from "./retrieval";

/**
 * Puts the demo hospital's patient leaflets in its library at DATABASE_URL (staging, synthetic data only), through the
 * library's own ingest. Safe to rerun. It lives here, not beside the rest of the seed, because the library does
 * (packages/db cannot import this package). Run after `bun run db:seed`, with packages/db's environment:
 * `cd packages/db && bunx varlock run -- bun ../retrieval/src/seed-run.ts`.
 * ponytail: no embedder outside the Worker, so the leaflets are stored without vectors and keywords find them (ingest's
 * own fallback); one `library.reindex` from a signed-in clinician adds the vectors.
 */
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
const db = createDb({ DATABASE_URL: process.env.DATABASE_URL });
const noEmbedder: Embedder = async () => { throw new Error("no embedder outside the Worker"); };
console.log(`Seeded ${await seedLeaflets((doc, text) => ingest(db, doc, text, noEmbedder))} patient leaflets (synthetic data), without vectors: run library.reindex once.`);
