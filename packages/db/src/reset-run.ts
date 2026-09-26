import "varlock/auto-load";

import { createDb } from "./index";
import { resetDemo } from "./reset";

/**
 * Resets the demo hospital at DATABASE_URL (staging, synthetic data only) to its seeded start,
 * deleting everything a demo run wrote. `bun run db:reset-demo`.
 */
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
await resetDemo(createDb({ DATABASE_URL: process.env.DATABASE_URL }));
console.log("Reset the demo ward to its seeded start (synthetic data).");
