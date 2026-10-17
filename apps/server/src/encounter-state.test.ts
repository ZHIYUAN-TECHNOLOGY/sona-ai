import { DEMO_HOSPITAL, seedDemo } from "@sona-ai/db/seed";
import { createTestDb, type TestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";

import { EncounterState } from "./encounter-state";

/** The one Durable Object storage surface the class uses, kept in memory. */
function memoryStorage() {
  const data = new Map<string, unknown>();
  return { get: async (key: string) => structuredClone(data.get(key)), put: async (key: string, value: unknown) => void data.set(key, structuredClone(value)) };
}
const objectFor = (db: TestDb, storage = memoryStorage()) => new EncounterState({ storage } as unknown as DurableObjectState, { DATABASE_URL: "" }, db);
const inputs = { weightKg: "62", liverDisease: "no", kidneyDisease: "no", alcoholRisk: "no", paracetamolAllergy: "no" } as const;

async function seeded() {
  const db = await createTestDb();
  await seedDemo(db);
  return db;
}

test("the object starts from the Postgres snapshot and every accepted edit is snapshotted back", async () => {
  const db = await seeded();
  const live = objectFor(db);
  expect(await live.get(DEMO_HOSPITAL, "visit-1042")).toEqual({ encounterId: "visit-1042", revision: 1, state: {} });

  const edited = await live.edit(DEMO_HOSPITAL, { encounterId: "visit-1042", expectedRevision: 1, prescriptionInputs: inputs });
  expect(edited.revision).toBe(2);
  expect(await live.get(DEMO_HOSPITAL, "visit-1042")).toEqual(edited);
  // A fresh object (evicted, empty storage) reads the same state back from Postgres.
  expect(await objectFor(db).get(DEMO_HOSPITAL, "visit-1042")).toEqual(edited);
});

test("a medicine edit after a recorded review invalidates it; a stale write is refused", async () => {
  const live = objectFor(await seeded());
  const reviewed = await live.recordReview(DEMO_HOSPITAL, { encounterId: "visit-1042", expectedRevision: 1 });
  expect(reviewed).toMatchObject({ revision: 1, state: { medicationCheckedRevision: 1, reviewInvalidated: false } });

  const edited = await live.edit(DEMO_HOSPITAL, { encounterId: "visit-1042", expectedRevision: 1, proposedMedicine: "Paracetamol" });
  expect(edited.revision).toBe(2);
  expect(edited.state).toMatchObject({ reviewInvalidated: true, proposedMedicine: "Paracetamol" });
  expect(edited.state.medicationCheckedRevision).not.toBe(2);

  expect((await live.edit(DEMO_HOSPITAL, { encounterId: "visit-1042", expectedRevision: 1, proposedMedicine: "Ibuprofen" }).catch(e => e)).code).toBe("CONFLICT");
  expect((await live.recordReview(DEMO_HOSPITAL, { encounterId: "visit-1042", expectedRevision: 1 }).catch(e => e)).code).toBe("CONFLICT");
  expect(await live.get(DEMO_HOSPITAL, "visit-1042")).toEqual(edited);
});

test("when Postgres has moved on under the object, its write is refused and it catches up", async () => {
  const db = await seeded();
  const live = objectFor(db);
  await live.get(DEMO_HOSPITAL, "visit-1086");
  const elsewhere = await objectFor(db).edit(DEMO_HOSPITAL, { encounterId: "visit-1086", expectedRevision: 1, proposedMedicine: "Paracetamol" });

  const error = await live.edit(DEMO_HOSPITAL, { encounterId: "visit-1086", expectedRevision: 1, proposedMedicine: "Ibuprofen" }).catch(e => e);
  expect(error.code).toBe("CONFLICT");
  expect(await live.get(DEMO_HOSPITAL, "visit-1086")).toEqual(elsewhere);
});

test("an edit through the object keeps discharge and claim fixes written beside it since the object last read", async () => {
  const db = await seeded();
  const live = objectFor(db);
  await live.get(DEMO_HOSPITAL, "visit-1042"); // the object caches the snapshot
  // Discharge and claim fixes are merged into Postgres in place, without going through the object.
  await db.$client.query(`update encounters set state = jsonb_set(state, '{discharge}', '{"medsConfirmed":true}'::jsonb) where id = 'visit-1042'`);
  const edited = await live.edit(DEMO_HOSPITAL, { encounterId: "visit-1042", expectedRevision: 1, prescriptionInputs: inputs });
  expect(edited.state.discharge).toEqual({ medsConfirmed: true });
  const [row] = (await db.$client.query<{ d: unknown }>(`select state->'discharge' as d from encounters where id = 'visit-1042'`)).rows;
  expect(row?.d).toEqual({ medsConfirmed: true });
});

test("a read shows what Postgres holds now: fixes merged beside the object, or a demo reset, are never hidden by its copy", async () => {
  const db = await seeded();
  const live = objectFor(db);
  await live.edit(DEMO_HOSPITAL, { encounterId: "visit-1042", expectedRevision: 1, prescriptionInputs: inputs });
  await db.$client.query(`update encounters set state = jsonb_set(state, '{discharge}', '{"medsConfirmed":true}'::jsonb) where id = 'visit-1042'`);
  expect((await live.get(DEMO_HOSPITAL, "visit-1042")).state).toMatchObject({ discharge: { medsConfirmed: true }, prescriptionInputs: inputs });
  await db.$client.query(`update encounters set state = '{}'::jsonb, revision = 1 where id = 'visit-1042'`);
  expect(await live.get(DEMO_HOSPITAL, "visit-1042")).toEqual({ encounterId: "visit-1042", revision: 1, state: {} });
});
