import type { PgAsyncDatabase } from "drizzle-orm/pg-core/async";

import { admissions, encounters, guaranteeLetters, hospitals, patients } from "./schema";

/**
 * The demo ward's starting state, matching the app's fixtures (synthetic people only). Idempotent,
 * so it can run on every boot of a test or staging database. Lane D extends it with reference data.
 */
export const DEMO_HOSPITAL = "demo";
// Any drizzle Postgres database: Neon in staging, PGlite in tests.
type AnyDb = PgAsyncDatabase<any, any>;

export async function seedDemo(db: AnyDb) {
  await db.insert(hospitals).values({ id: DEMO_HOSPITAL, name: "Demo General Hospital (synthetic)" }).onConflictDoNothing();
  await db.insert(patients).values([
    { id: "SYN-1042", hospitalId: DEMO_HOSPITAL, name: "Amelia Tan", initials: "AT", age: 42, sex: "Female", complaint: "Cough for five days, with fever since yesterday.", allergies: "Penicillin — reported rash; details need confirmation" },
    { id: "SYN-1086", hospitalId: DEMO_HOSPITAL, name: "Daniel Rahman", initials: "DR", age: 57, sex: "Male", complaint: "Breathlessness on exertion; onset not yet documented.", incomplete: true },
  ]).onConflictDoNothing();
  await db.insert(encounters).values([
    { id: "visit-1042", patientId: "SYN-1042", hospitalId: DEMO_HOSPITAL },
    { id: "visit-1086", patientId: "SYN-1086", hospitalId: DEMO_HOSPITAL },
  ]).onConflictDoNothing();
  await db.insert(admissions).values({ id: "adm-1042", patientId: "SYN-1042", hospitalId: DEMO_HOSPITAL, bed: "Bed 6" }).onConflictDoNothing();
  await db.insert(guaranteeLetters).values({ id: "gl-1042", admissionId: "adm-1042", insurer: "Synthetic insurer", status: "requested", requestedAt: new Date("2026-09-25T09:40:00+08:00") }).onConflictDoNothing();
}
