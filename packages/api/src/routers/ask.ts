import { z } from "zod";

import { webAnswer } from "../ask-context";
import { freeAnswer, routeRequest } from "../ask-model";
import { askContextSchema } from "../ask-spec";
import { protectedProcedure } from "../index";

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
  free: protectedProcedure.input(z.object({ scope: z.string().max(40), question: z.string().trim().min(1).max(500), context: askContextSchema.default({ lines: [], rows: [] }) }))
    .handler(async ({ context, input }) => {
      if (input.scope === "web") return webAnswer(context, input.question);
      return context.baseten ? freeAnswer(context.baseten, input) : { source: "fixture" as const };
    }),
};
