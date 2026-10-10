import { encounters } from "@sona-ai/db/schema/clinical";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { webAnswer } from "../ask-context";
import { freeAnswer, routeRequest } from "../ask-model";
import { askContextSchema, type AskContext } from "../ask-spec";
import type { Context } from "../context";
import { protectedProcedure } from "../index";
import { recordText } from "./evidence";

/**
 * Sona's ask bar on the models (./ask-model). Without a Baseten key both answer `{ source: "fixture" }`,
 * and the app keeps its keyword routing and its page's rule-based answers. The web (scope "web") sends no page data:
 * the server reads it and always answers (./ask-context).
 */
export const askRouter = {
  /** Which card answers a typed or spoken visit request (Laya). `patient` is the visit label, e.g. "Respiratory review". */
  route: protectedProcedure.input(z.object({ request: z.string().trim().min(1).max(500), patient: z.string().max(120) }))
    .handler(({ context, input }) => context.baseten ? routeRequest(context.baseten, input) : { source: "fixture" as const }),
  /** A page's free question, answered from the page's own data (`context`) as an ask-catalogue spec (Gemma), or fixture. */
  free: protectedProcedure.input(z.object({
    scope: z.string().max(40), question: z.string().trim().min(1).max(500), context: askContextSchema.default({ lines: [], rows: [] }),
    /** The open visit: its patient's record is read here and added to the page's lines, so "her last potassium" is hers. */
    encounterId: z.string().max(80).optional(),
  }))
    .handler(async ({ context, input }) => {
      if (input.scope === "web") return webAnswer(context, input.question);
      if (!context.baseten) return { source: "fixture" as const };
      const record = input.encounterId ? await visitRecord(context, context.hospitalId, input.encounterId) : [];
      return freeAnswer(context.baseten, { ...input, context: { ...input.context, lines: [...input.context.lines, ...record] } });
    }),
};

/**
 * The visit's patient's record (evidence's recordText: what the hospital recorded, then the visit's note) as page lines,
 * only for a visit of the clinician's own hospital; none when it cannot be read, so the question is still answered.
 */
async function visitRecord(context: Context, hospitalId: string, encounterId: string): Promise<AskContext["lines"]> {
  const [visit] = await context.db.select({ patientId: encounters.patientId }).from(encounters)
    .where(and(eq(encounters.id, encounterId), eq(encounters.hospitalId, hospitalId))).catch(() => []);
  if (!visit) return [];
  const text = await recordText(context.db, hospitalId, visit.patientId, encounterId).catch(() => "");
  return text ? ["This visit's patient record:", ...text.split("\n")] : [];
}
