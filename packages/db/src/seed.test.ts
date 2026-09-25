import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { admissions, guaranteeLetters, patients } from "./schema";
import { DEMO_HOSPITAL, seedDemo } from "./seed";
import { createTestDb } from "./testing";

test("the demo seed has the two visit patients and Amelia in bed 6 awaiting her final GL", async () => {
  const db = await createTestDb();
  await seedDemo(db);
  await seedDemo(db); // seeding twice is harmless
  const rows = await db.select().from(patients).where(eq(patients.hospitalId, DEMO_HOSPITAL));
  expect(rows.map(p => p.name).sort()).toEqual(["Amelia Tan", "Daniel Rahman"]);
  const [bed] = await db.select().from(admissions).where(eq(admissions.patientId, "SYN-1042"));
  expect(bed?.bed).toBe("Bed 6");
  const [gl] = await db.select().from(guaranteeLetters).where(eq(guaranteeLetters.admissionId, bed!.id));
  expect(gl?.status).toBe("requested");
});
