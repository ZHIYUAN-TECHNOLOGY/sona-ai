import "varlock/auto-load";

import { createDb } from "./index";
import { seedDemo } from "./seed";

/**
 * Seeds the database at DATABASE_URL (staging, synthetic data only) with the demo ward. Safe to
 * rerun. Run after `bun run db:migrate`: `bun run db:seed`.
 */
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
await seedDemo(createDb({ DATABASE_URL: process.env.DATABASE_URL }));
console.log("Seeded the demo ward (synthetic data).");
