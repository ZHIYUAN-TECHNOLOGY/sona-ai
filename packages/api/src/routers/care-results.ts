import { ORPCError } from "@orpc/server";
import { labResults } from "@sona-ai/db/schema/clinical";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { patientProcedure } from "../index";
import { stubModels } from "../models";

const lang = z.enum(["en", "ms", "zh"]);

/**
 * Released to the patient: a doctor has acknowledged it, and it is a result (not a sample still at the lab).
 * Until then the patient is told only that the test exists and their care team is reviewing it, so they never
 * read a critical value before a clinician has.
 */
const released = (r: typeof labResults.$inferSelect) => r.acknowledgedAt !== null && r.flag !== "pending";

/** Sona Care: the signed-in patient's own lab results. The patient comes from their care link, never from the client. */
export const careResultsRouter = {
  /** Newest first. An unreleased result carries no value, unit or flag: `released: false`. */
  list: patientProcedure.input(z.object({ lang: lang.optional() }).optional()).handler(async ({ context }) => {
    const rows = await context.db.select().from(labResults).where(eq(labResults.patientId, context.patientId)).orderBy(desc(labResults.receivedAt));
    return rows.map(r => released(r)
      ? { id: r.id, test: r.test, at: r.receivedAt, released: true as const, acknowledged: true, value: r.value, unit: r.unit ?? undefined, flag: r.flag ?? undefined }
      : { id: r.id, test: r.test, at: r.receivedAt, released: false as const, acknowledged: false });
  }),

  /** What one released result of theirs means, in plain words. Another patient's or an unreleased result is NOT_FOUND. */
  explain: patientProcedure.input(z.object({ resultId: z.string().min(1), lang: lang.optional() })).handler(async ({ context, input }) => {
    const [r] = await context.db.select().from(labResults).where(and(eq(labResults.id, input.resultId), eq(labResults.patientId, context.patientId)));
    if (!r || !released(r)) throw new ORPCError("NOT_FOUND", { message: "That result was not found" });
    const said = await (context.models ?? stubModels).explainResult({ test: r.test, value: r.value, unit: r.unit ?? undefined, flag: r.flag ?? undefined, language: input.lang ?? "en" });
    return { text: said.text, source: said.source, ...said.source === "fixture" && said.waking !== undefined && { waking: said.waking } };
  }),
};
