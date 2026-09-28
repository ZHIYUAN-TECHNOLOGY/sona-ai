import "varlock/auto-load";

import { createDb } from "./index";
import { seedDemo, seedTestPatient } from "./seed";

/**
 * Seeds the database at DATABASE_URL (staging, synthetic data only) with the demo ward. Safe to
 * rerun. Run after `bun run db:migrate`: `bun run db:seed`.
 */
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
const db = createDb({ DATABASE_URL: process.env.DATABASE_URL });
await seedDemo(db);
// The Sona Care demo account (TEST_PATIENT), already linked to Amelia.
await seedTestPatient(db);
console.log("Seeded the demo ward and the Sona Care test patient (synthetic data).");
