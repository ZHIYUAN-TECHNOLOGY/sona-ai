import { z } from "zod";

import { freeAnswer, routeRequest } from "../ask-model";
import { askContextSchema } from "../ask-spec";
import { protectedProcedure } from "../index";

/**
 * Sona's ask bar on the models (./ask-model). Without a Baseten key both answer `{ source: "fixture" }`,
 * and the app keeps its keyword routing and its page's rule-based answers.
 */
export const askRouter = {
  /** Which card answers a typed or spoken visit request (Laya). `patient` is the visit label, e.g. "Respiratory review". */
  route: protectedProcedure.input(z.object({ request: z.string().trim().min(1).max(500), patient: z.string().max(120) }))
    .handler(({ context, input }) => context.baseten ? routeRequest(context.baseten, input) : { source: "fixture" as const }),
  /** A page's free question, answered from the page's own data (`context`) as an ask-catalogue spec (Gemma), or fixture. */
  free: protectedProcedure.input(z.object({ scope: z.string().max(40), question: z.string().trim().min(1).max(500), context: askContextSchema }))
    .handler(({ context, input }) => context.baseten ? freeAnswer(context.baseten, input) : { source: "fixture" as const }),
};
