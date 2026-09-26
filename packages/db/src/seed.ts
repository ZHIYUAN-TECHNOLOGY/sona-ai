import { sql } from "drizzle-orm";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core/async";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { admissions, appointments, casemixWeights, drugs, encounters, followUpRules, guaranteeLetters, hospitals, icd10Codes, insurerCriteria, labResults, notes, observations, patients } from "./schema";

/**
 * The demo ward's starting state, matching the app's fixtures (synthetic people only). Idempotent,
 * so it can run on every boot of a test or staging database. Reference tables (ICD-10, drugs) load
 * from the repo's data/ folder and are upserted, so a corrected file reaches a seeded database.
 * Reads files from disk: run it from Bun/Node (tests, a seed script), not inside the Worker.
 */
export const DEMO_HOSPITAL = "demo";
/** The synthetic test doctor for local and staging end-to-end runs (never a real person or account). */
export const TEST_DOCTOR = { name: "Dr Test Aisyah", email: "dr.test@sona.test", password: "Sona-7rcVayfxIuzr" };
// Any drizzle Postgres database: Neon in staging, PGlite in tests.
type AnyDb = PgAsyncDatabase<any, any>;

export async function seedDemo(db: AnyDb, now = new Date()) {
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
  await db.insert(icd10Codes).values(readCsv("icd10.csv").map(r => ({ code: r.code!, label: r.label!, chapter: r.chapter })))
    .onConflictDoUpdate({ target: icd10Codes.code, set: { label: sql`excluded.label`, chapter: sql`excluded.chapter` } });
  await db.insert(drugs).values(readCsv("drugs.csv").map(r => ({ id: r.id!, name: r.name!, ingredient: r.ingredient!, formulation: r.formulation, dose: r.dose!, sourceId: r.source_id! })))
    .onConflictDoUpdate({ target: drugs.id, set: { name: sql`excluded.name`, ingredient: sql`excluded.ingredient`, formulation: sql`excluded.formulation`, dose: sql`excluded.dose`, sourceId: sql`excluded.source_id` } });
  // Amelia's CURB-65 inputs (confusion is a 0/1 flag; AMT 10/10), each citable by its own source ID.
  const observedAt = new Date("2026-09-22T09:26:00+08:00");
  // Confusion is the abbreviated mental test out of 10, the scale CURB-65 reads (8 or less scores).
  await db.insert(observations).values(([["confusion", 10, "AMT"], ["urea", 5.1, "mmol/L"], ["respiratory-rate", 18, "/min"], ["systolic", 124, "mmHg"], ["diastolic", 78, "mmHg"]] as const)
    .map(([kind, value, unit]) => ({ id: `obs-1042-${kind}`, patientId: "SYN-1042", kind, value, unit, sourceId: `obs-1042-${kind}`, observedAt })))
    .onConflictDoUpdate({ target: observations.id, set: { value: sql`excluded.value`, unit: sql`excluded.unit` } });
  // Daniel's potassium arrived two hours ago, like the app's pending result; reseeding keeps it two hours old.
  await db.insert(labResults).values({ id: "lab-1086-potassium", patientId: "SYN-1086", test: "Potassium", value: "3.1", unit: "mmol/L", flag: "low", sourceId: "lab-1086-potassium", receivedAt: new Date(now.getTime() - 2 * 3600_000) })
    .onConflictDoUpdate({ target: labResults.id, set: { receivedAt: sql`excluded.received_at` } });
  // The synthetic insurer's rules behind the final-GL checks in the claim flow (ids match the app's check ids).
  await db.insert(insurerCriteria).values([
    { id: "severity", label: "Severity score documented", rule: { requires: "severity-score" } },
    { id: "imaging", label: "Imaging result attached", rule: { requires: "imaging-report" } },
    { id: "stay", label: "Stay within the approved plan", rule: { maxStayDays: 3 } },
    { id: "organism", code: "J18.9", label: "Organism documented", rule: { requires: "organism-statement" } },
    { id: "iv", label: "Reason for IV antibiotics", rule: { requires: "iv-reason" } },
  ].map(c => ({ ...c, id: `synthetic-${c.id}`, insurer: "Synthetic insurer" }))).onConflictDoNothing();
  // SYNTHETIC casemix weights for the coding-audit codes on an RM 4,500 base rate, picked so the
  // weight gaps roughly reproduce the audit screen's amounts at risk. Not real MY-DRG values.
  const weights: Record<string, number> = {
    "J18.9": 0.92, N10: 0.85, "B96.2": 0.41, "K35.8": 0.8, "K35.3": 1.32, "I50.9": 1.05, "I50.0": 1.52, I64: 1.2, "I63.9": 1.88, "L03.9": 0.62, "L03.1": 0.79,
    "D64.9": 0.14, "J44.9": 0.88, "J44.1": 1.16, "E87.1": 0.21, "N17.9": 0.34, "A41.9": 1.4, "A41.5": 1.86, "J45.9": 0.7, J46: 0.96,
  };
  await db.insert(casemixWeights).values(Object.entries(weights).map(([code, weight]) => ({ code, weight, baseRateCents: 450_000 })))
    .onConflictDoUpdate({ target: casemixWeights.code, set: { weight: sql`excluded.weight`, baseRateCents: sql`excluded.base_rate_cents` } });
  // Today's visits, 15 and 45 minutes from `now` like the app's demo slots; reseeding moves them to the new today.
  await db.insert(appointments).values(([["SYN-1042", 15], ["SYN-1086", 45]] as const).map(([patientId, minutes]) => (
    { id: `appt-${patientId}`, patientId, hospitalId: DEMO_HOSPITAL, kind: "clinic visit", startsAt: new Date(now.getTime() + minutes * 60_000) })))
    .onConflictDoUpdate({ target: appointments.id, set: { startsAt: sql`excluded.starts_at` } });
  await db.insert(guaranteeLetters).values({ id: "gl-1042", admissionId: "adm-1042", insurer: "Synthetic insurer", status: "requested", requestedAt: new Date("2026-09-25T09:40:00+08:00") }).onConflictDoNothing();
  // Daniel's note and a haemoglobin the note does not mention: the coding audit's worked example.
  await db.insert(notes).values({ id: "note-1086-1", encounterId: "visit-1086", revision: 1, sentences: [{ id: "s1", text: "Breathless on exertion; onset not yet documented." }, { id: "s2", text: "Tablet reported; ingredient unknown." }] }).onConflictDoNothing();
  await db.insert(labResults).values({ id: "lab-hb-1086", patientId: "SYN-1086", test: "Hb", value: "9.8", unit: "g/dL", flag: "low", sourceId: "lab-hb-1086", receivedAt: new Date(now.getTime() - 26 * 3600_000) }).onConflictDoNothing();
  // Demo flow 6: follow-up intervals are looked up from this table, never generated.
  const num = (v?: string) => (v ? Number(v) : null);
  await db.insert(followUpRules).values(readCsv("follow-up-rules.csv").map(r => ({
    id: r.id!, kind: r.kind as "nodule", riskBand: r.risk_band as "low", minMm: num(r.min_mm), maxMm: num(r.max_mm),
    intervalDays: num(r.interval_days), action: r.action!, source: r.source!,
  }))).onConflictDoUpdate({ target: followUpRules.id, set: { intervalDays: sql`excluded.interval_days`, action: sql`excluded.action`, source: sql`excluded.source`, minMm: sql`excluded.min_mm`, maxMm: sql`excluded.max_mm` } });
}

/** Rows of a reference file in the repo's data/ folder; `#` lines are provenance notes, quoted fields may hold commas. */
function readCsv(file: string): Record<string, string>[] {
  const lines = readFileSync(fileURLToPath(new URL(`../../../data/${file}`, import.meta.url).href), "utf8").split("\n").filter(l => l.trim() && !l.startsWith("#"));
  const split = (l: string) => [...l.matchAll(/("([^"]*)"|[^,]*)(,|$)/g)].slice(0, -1).map(m => m[2] ?? m[1]!);
  const [header, ...rows] = lines.map(split);
  return rows.map(r => Object.fromEntries(header!.map((h, i) => [h, r[i]!])));
}
