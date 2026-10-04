import "varlock/auto-load";

import { createDb } from "./index";
import { seedDemo, seedDemoNote, seedTestPatient, seedTestStaff } from "./seed";

/**
 * Seeds the database at DATABASE_URL (staging, synthetic data only) with the demo ward. Safe to
 * rerun. Run after `bun run db:migrate`: `bun run db:seed`.
 */
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
const db = createDb({ DATABASE_URL: process.env.DATABASE_URL });
await seedDemo(db);
// Amelia's saved note for her stay, which her discharge and guarantee letter build on.
await seedDemoNote(db);
// The Sona Care demo account (TEST_PATIENT), already linked to Amelia.
await seedTestPatient(db);
// Two colleagues at the demo hospital (TEST_DOCTOR_2, TEST_NURSE_2), so a handover has someone to receive it.
await seedTestStaff(db);
console.log("Seeded the demo ward, the Sona Care test patient and two test colleagues (synthetic data).");
