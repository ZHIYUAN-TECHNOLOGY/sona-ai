import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { hospitals, patients } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { healthSummaryHtml } from "../health-summary-pdf";
import { healthSummaryOf } from "./health-summary";
import { appRouter } from "./index";

const session = (id: string) => ({ user: { id, name: id, email: `${id}@demo.test` }, session: { id: `s-${id}`, userId: id } } as unknown as Session);

test("the health summary is the patient's own record, only in their hospital, and only for clinical roles", async () => {
  const db = await createTestDb();
  const now = new Date("2026-09-26T10:00:00+08:00");
  await seedDemo(db, now);
  await db.insert(hospitals).values({ id: "other", name: "Other" });
  await addClinician(db, "beds", undefined, "bed-manager");
  const [row] = await db.select().from(patients).where(eq(patients.id, "SYN-1042"));
  const context = { db, now: () => now, hospitalId: row!.hospitalId, patientId: "SYN-1042" };

  const s = await healthSummaryOf(context as never);
  expect(s.patient).toMatchObject({ id: "SYN-1042", name: row!.name });
  expect(s.allergies).toBe(row!.allergies);
  expect(s.medicines.length).toBeGreaterThan(0);
  expect(s.results.every(r => r.flag !== "pending")).toBe(true);
  // Insight first: the name, then the allergy, before any section.
  const html = healthSummaryHtml(s);
  expect(html.indexOf(row!.name)).toBeLessThan(html.indexOf("Allergies"));
  expect(html.indexOf("Allergies")).toBeLessThan(html.indexOf("Problems and history"));

  await expect(healthSummaryOf({ ...context, hospitalId: "other" } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
  const beds = createRouterClient(appRouter, { context: { db, session: session("beds"), now: () => now } });
  await expect(beds.patients.summary({ patientId: "SYN-1042" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(beds.patients.summaryData({ patientId: "SYN-1042" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  // The page reads the very object the PDF renders.
  await addClinician(db, "doc");
  const doctor = createRouterClient(appRouter, { context: { db, session: session("doc"), now: () => now } });
  expect(await doctor.patients.summaryData({ patientId: "SYN-1042" })).toEqual(s);
});
