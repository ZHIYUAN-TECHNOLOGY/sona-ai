import { hashPassword } from "better-auth/crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core/async";
import { DEMO_PATIENTS } from "@sona-ai/domain/demo-patients";
import { DOCTORS } from "@sona-ai/domain/doctors";
import { DEMO_WARD, WARD_FIXTURE, type BlockerKind } from "@sona-ai/domain/ward";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { account, admissions, appointments, careLinks, casemixWeights, doctors, drugs, encounters, followUpRules, guaranteeLetters, hospitals, icd10Codes, insurerCriteria, labResults, notes, observations, patients, user } from "./schema";

/**
 * The demo ward's starting state, matching the app's fixtures (synthetic people only). Idempotent,
 * so it can run on every boot of a test or staging database. Reference tables (ICD-10, drugs) load
 * from the repo's data/ folder and are upserted, so a corrected file reaches a seeded database.
 * Reads files from disk: run it from Bun/Node (tests, a seed script), not inside the Worker.
 */
import { DEMO_HOSPITAL, DEMO_PATIENT_PHONE } from "./demo";
export { DEMO_HOSPITAL };
/**
 * The rest of the ward, read off the fixture beds so live mode draws the same ward: bed N holds SYN-20NN
 * with each blocker turned into the row it derives from (a requested GL, a pending result, discharge state).
 */
const WARD = WARD_FIXTURE.filter(b => b.name).map(b => {
  const n = b.bed.replace("Bed ", "").padStart(2, "0"), of = (kind: BlockerKind) => b.blockers.filter(x => x.kind === kind);
  const [age, sex] = b.meta!.split(" · "), [ride] = of("transport");
  const state = {
    ...(b.status === "fit" && { discharge: { medsConfirmed: !of("pharmacy").length, followUp: "2w" } }),
    // Transport has no table yet: a ride or transfer still to arrange lives in the visit state.
    ...(ride && { transport: { label: ride.label, detail: ride.detail } }),
  };
  return { n, id: `SYN-20${n}`, bed: b, age: Number(age), sex: sex!, state, gl: of("gl").length > 0, labs: of("result").map(r => ({ id: `lab-20${n}-${r.id}`, test: r.label })) };
});
/** The lab results the seed writes; any other result arrived during a demo run. */
export const SEED_LAB_IDS = ["lab-1086-potassium", "lab-hb-1086", ...WARD.flatMap(w => w.labs.map(l => l.id))];
/** The synthetic test doctor for local and staging end-to-end runs (never a real person or account). */
export const TEST_DOCTOR = { name: "Dr Test Aisyah", email: "dr.test@sona.test", password: "Sona-7rcVayfxIuzr" };
/**
 * Synthetic test accounts for the other clinician roles (never real people). Sign up in the app with
 * these; the first sign-in joins the demo hospital with the role in DEMO_CLINICIANS (demo.ts).
 */
export const TEST_NURSE = { name: "Nurse Test Mei Ling", email: "nurse.test@sona.test", password: "Sona-DqqMailMAYIgh" };
export const TEST_BED_MANAGER = { name: "Test Bed Manager Hafiz", email: "beds.test@sona.test", password: "Sona-xcEhUim76L7g" };
export const TEST_MANAGER = { name: "Test Manager Farah", email: "manager.test@sona.test", password: "Sona-A6lR268CDTts" };
/**
 * The synthetic test patient for Sona Care runs (never a real person): seeded as a signed-up account
 * already linked to Amelia (SYN-1042) by seedTestPatient, so it signs in with this email and password,
 * or with the demo phone (DEMO_PATIENT_PHONE), without a doctor issuing a code.
 */
export const TEST_PATIENT = { name: "Amelia Tan", email: "amelia.test@sona.test", password: "Care-MGnI1hY8BWoR", phone: DEMO_PATIENT_PHONE, patientId: "SYN-1042" };
// Any drizzle Postgres database: Neon in staging, PGlite in tests.
type AnyDb = PgAsyncDatabase<any, any>;

export async function seedDemo(db: AnyDb, now = new Date()) {
  await db.insert(hospitals).values({ id: DEMO_HOSPITAL, name: "Demo General Hospital (synthetic)" }).onConflictDoNothing();
  // The synthetic doctor directory Sona Care's Find a doctor reads.
  await db.insert(doctors).values(DOCTORS.map(d => ({ ...d, careTeam: d.careTeam ?? false, hospitalId: DEMO_HOSPITAL })))
    .onConflictDoUpdate({ target: doctors.id, set: { days: sql`excluded.days`, times: sql`excluded.times`, room: sql`excluded.room` } });
  // The same records the app's fixtures show; the rest of each record (history, medicines, vitals, sources) is kept whole in `record`.
  // The ward's own view of each admitted patient (status, SBAR, predicted time) is kept in `record.ward`.
  await db.insert(patients).values([
    ...DEMO_PATIENTS.map(({ id, name, initials, age, sex, complaint, allergies, incomplete, encounterId: _, ...record }) =>
      ({ id, hospitalId: DEMO_HOSPITAL, name, initials, age, sex, complaint, allergies, incomplete, record: id === "SYN-1042" ? { ...record, ward: DEMO_WARD } : record })),
    ...WARD.map(({ id, bed: { name, initials, status, predicted, waitingHours, sbar }, age, sex }) =>
      ({ id, hospitalId: DEMO_HOSPITAL, name: name!, initials: initials!, age, sex, complaint: sbar!.s, record: { ward: { status, predicted, waitingHours, sbar } } })),
  ])
    .onConflictDoUpdate({ target: patients.id, set: { complaint: sql`excluded.complaint`, allergies: sql`excluded.allergies`, incomplete: sql`excluded.incomplete`, record: sql`excluded.record` } });
  await db.insert(encounters).values([
    { id: "visit-1042", patientId: "SYN-1042", hospitalId: DEMO_HOSPITAL },
    { id: "visit-1086", patientId: "SYN-1086", hospitalId: DEMO_HOSPITAL },
  ]).onConflictDoNothing();
  await db.insert(admissions).values({ id: "adm-1042", patientId: "SYN-1042", hospitalId: DEMO_HOSPITAL, bed: "Bed 6" }).onConflictDoNothing();
  // The rest of the ward. A visit's state is only written while empty (new, or just reset), so a run's changes survive a reboot;
  // fit beds became fit `waitingHours` ago, kept that old on every reseed like the potassium below.
  await db.insert(encounters).values(WARD.map(w => ({ id: `visit-20${w.n}`, patientId: w.id, hospitalId: DEMO_HOSPITAL, state: w.state })))
    .onConflictDoUpdate({ target: encounters.id, set: { state: sql`excluded.state` }, setWhere: sql`${encounters.state} = '{}'::jsonb` });
  await db.insert(admissions).values(WARD.map(w => ({ id: `adm-20${w.n}`, patientId: w.id, hospitalId: DEMO_HOSPITAL, bed: w.bed.bed, fitAt: w.bed.status === "fit" ? new Date(now.getTime() - (w.bed.waitingHours ?? 0) * 3600_000) : null })))
    .onConflictDoUpdate({ target: admissions.id, set: { fitAt: sql`excluded.fit_at` } });
  await db.insert(guaranteeLetters).values(WARD.filter(w => w.gl).map(w => ({ id: `gl-20${w.n}`, admissionId: `adm-20${w.n}`, insurer: "Synthetic insurer", status: "requested" as const, requestedAt: now }))).onConflictDoNothing();
  // A pending result's time is when the lab logged the sample (two days ago), so it never reads as the newest result.
  await db.insert(labResults).values(WARD.flatMap(w => w.labs.map(l => ({ id: l.id, patientId: w.id, test: l.test, value: "", flag: "pending", sourceId: l.id, receivedAt: new Date(now.getTime() - 48 * 3600_000) }))))
    .onConflictDoUpdate({ target: labResults.id, set: { receivedAt: sql`excluded.received_at` } });
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

/**
 * TEST_PATIENT as a real Sona Care account: the user (email verified, the demo phone verified), an
 * email-and-password login, and the link to Amelia's record. Safe to rerun: an account that already
 * exists (even one signed up in the app) is reused, and a stray account holding the demo phone gives it up.
 */
export async function seedTestPatient(db: AnyDb) {
  const { email, name, password, phone, patientId } = TEST_PATIENT;
  await db.insert(user).values({ id: "test-patient-amelia", name, email, emailVerified: true }).onConflictDoNothing();
  const [{ id }] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)) as [{ id: string }];
  await db.update(user).set({ phoneNumber: null, phoneNumberVerified: null }).where(and(eq(user.phoneNumber, phone), ne(user.id, id)));
  await db.update(user).set({ phoneNumber: phone, phoneNumberVerified: true }).where(eq(user.id, id));
  const [login] = await db.select({ id: account.id }).from(account).where(and(eq(account.userId, id), eq(account.providerId, "credential")));
  if (!login) await db.insert(account).values({ id: `credential-${id}`, accountId: id, providerId: "credential", userId: id, password: await hashPassword(password) });
  await db.insert(careLinks).values({ userId: id, hospitalId: DEMO_HOSPITAL, patientId }).onConflictDoNothing();
  return id;
}

/** Rows of a reference file in the repo's data/ folder; `#` lines are provenance notes, quoted fields may hold commas. */
function readCsv(file: string): Record<string, string>[] {
  const lines = readFileSync(fileURLToPath(new URL(`../../../data/${file}`, import.meta.url).href), "utf8").split("\n").filter(l => l.trim() && !l.startsWith("#"));
  const split = (l: string) => [...l.matchAll(/("([^"]*)"|[^,]*)(,|$)/g)].slice(0, -1).map(m => m[2] ?? m[1]!);
  const [header, ...rows] = lines.map(split);
  return rows.map(r => Object.fromEntries(header!.map((h, i) => [h, r[i]!])));
}
