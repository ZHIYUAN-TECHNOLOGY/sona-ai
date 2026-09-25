import { beforeAll, expect, test } from "bun:test";
// Relative import: @sona-ai/api already depends on this package, so a workspace dependency back would be a cycle.
import { drugLookupSchema } from "../../api/src/contracts";
import { drugLookup, searchIcd } from "./lookups";
import { seedDemo } from "./seed";
import { createTestDb, type TestDb } from "./testing";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
  await seedDemo(db);
});

test("an exact ICD-10 code comes back first", async () => {
  const [top] = await searchIcd(db, "J18.9");
  expect(top).toEqual({ code: "J18.9", label: "Pneumonia, unspecified" });
});

test("a description finds the WHO code it means, ranked first", async () => {
  const [top] = await searchIcd(db, "pneumonia unspecified organism");
  expect(top?.code).toBe("J18.9");
});

test("a narrower description puts the narrower code near the top", async () => {
  const hits = await searchIcd(db, "lobar pneumonia");
  expect(hits.slice(0, 3).map(h => h.code)).toContain("J18.1");
});

test("nonsense finds no code rather than a guess", async () => {
  expect(await searchIcd(db, "zqxv blorfendip")).toEqual([]);
});

test("a drug in the table comes back covered with its dose and source, by name or ingredient", async () => {
  const byName = drugLookupSchema.parse(await drugLookup(db, "AZITHROMYCIN"));
  expect(byName).toMatchObject({ status: "covered", drug: "Azithromycin" });
  if (byName.status === "covered") expect(byName.dose).toContain("500 mg");
  const byIngredient = drugLookupSchema.parse(await drugLookup(db, "albuterol"));
  expect(byIngredient).toMatchObject({ status: "covered", drug: "Salbutamol" });
});

test("anything outside the table is not covered, never a near match", async () => {
  expect(drugLookupSchema.parse(await drugLookup(db, "warfarin"))).toEqual({ status: "not-covered", drug: "warfarin" });
  expect(drugLookupSchema.parse(await drugLookup(db, "azithro"))).toEqual({ status: "not-covered", drug: "azithro" });
});
