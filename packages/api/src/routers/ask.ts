import { encounters, patients } from "@sona-ai/db/schema/clinical";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { webAnswer, webPage } from "../ask-context";
import { proCards } from "../answer-cards";
import { freeAnswer, routeRequest } from "../ask-model";
import { askContextSchema, type AskContext } from "../ask-spec";
import type { Context } from "../context";
import { decideTurn, laneOf, proLane, type Decision } from "../decide";
import { protectedProcedure } from "../index";
import { can } from "../roles";
import { recordText } from "./evidence";

/**
 * Sona's ask bar on the models (./ask-model). Without a Baseten key both answer `{ source: "fixture" }`,
 * and the app keeps its keyword routing and its page's rule-based answers. The web (scope "web") sends no page data:
 * the server reads it and always answers (./ask-context). A free question the Clef fast lane is sure of (../decide) is
 * answered by the rules at once, with its `lane`: the ward's list, or a task for the open visit drafted as an action
 * card (`cards`) the doctor confirms, for an app that shows cards; Gemma answers the rest as before.
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
    /** The app shows an answer's `cards`: an older Sona Pro shows the spec alone, so it is never drafted a task it cannot confirm. */
    cards: z.literal(true).optional(),
  }))
    .handler(async ({ context, input }) => {
      // A visit's record and rows only for a role that may open the visit: a bed manager sees the ward, not clinical detail.
      const encounterId = can(context.role, "encounter.get") ? input.encounterId : undefined;
      // Clef's read (none while CLEF_LANE is off), never waited for: the lane takes a turn only when Clef is in before the
      // turn's own reads are, so a turn Gemma answers is never slower for it. Its log line is kept after the answer.
      let decision: Decision | undefined;
      const deciding = decideTurn(context.clef, { app: "pro", said: input.question, open: Boolean(encounterId) }).then(d => { decision = d; });
      context.waitUntil?.(deciding);
      const fast = (open: Parameters<typeof proLane>[4]) => {
        const lane = laneOf(decision, "pro", input.question);
        return lane && proLane(context, lane, decision!, input.question, open).catch(error => { console.error("lane not answered", error); return undefined; });
      };
      if (input.scope === "web") {
        const page = await webPage(context);
        return (await fast({ page })) || webAnswer(context, input.question, page);
      }
      if (!context.baseten) return { source: "fixture" as const };
      const record = encounterId ? visitRecord(context, context.hospitalId, encounterId) : [];
      await Promise.race([record, deciding]);
      const answered = await fast({ encounterId, drafts: input.cards });
      if (answered) return answered;
      const answer = await freeAnswer(context.baseten, { ...input, context: { ...input.context, lines: [...input.context.lines, ...await record] } });
      // The visit's own rows for what the answer names (../answer-cards), beside the spec; none for an answer the app sends to
      // the evidence instead. A card that cannot be read never fails the answer.
      const cards = "marks" in answer && !("evidence" in answer) ? await proCards(context, { encounterId, marks: answer.marks }).catch(() => []) : [];
      return { ...answer, ...cards.length > 0 && { cards } };
    }),
};

/**
 * The visit's patient's record (evidence's recordText: what the hospital recorded, her stay, then the visit's note) as
 * page lines, only for a visit of the clinician's own hospital; none when it cannot be read, so the question is still
 * answered. At most RECORD_CHARS, whole lines from the top, so a long record leaves Gemma room to answer. Its header
 * names the patient (recordText leaves the name out for evidence's search): unnamed, a question about another bed was
 * answered with this patient's results as that bed's (10 Oct, review: "Ravi bed 9 K and creatinine how?", 10 of 10).
 */
async function visitRecord(context: Context, hospitalId: string, encounterId: string): Promise<AskContext["lines"]> {
  const [visit] = await context.db.select({ patientId: encounters.patientId, name: patients.name }).from(encounters)
    .innerJoin(patients, eq(patients.id, encounters.patientId))
    .where(and(eq(encounters.id, encounterId), eq(encounters.hospitalId, hospitalId))).catch(() => []);
  if (!visit) return [];
  const text = await recordText(context.db, hospitalId, visit.patientId, encounterId).catch(() => "");
  const kept = text.length > RECORD_CHARS ? text.slice(0, text.lastIndexOf("\n", RECORD_CHARS)) : text;
  return kept ? [`This visit's patient record (${visit.name}):`, ...kept.split("\n")] : [];
}
/**
 * About 1,300 of Gemma's 16,384 tokens (3 characters a token), beside the prompt and the page's own lines and rows.
 * Amelia's record with her stay is about 1,900 characters. Lines are kept whole: cutting the latest observations line at
 * 300 characters (a page line's limit) lost her temperature.
 * ponytail: a record past it loses its note and stay lines first; retrieval by the question if records grow.
 */
const RECORD_CHARS = 4000;
