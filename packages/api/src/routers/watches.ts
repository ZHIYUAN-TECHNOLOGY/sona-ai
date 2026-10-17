import { ORPCError } from "@orpc/server";
import { MAX_WATCHES } from "@sona-ai/domain/watch";
import { z } from "zod";

import type { Context } from "../context";
import { protectedProcedure } from "../index";

const agents = (context: Pick<Context, "watches">) => {
  if (!context.watches) throw new ORPCError("PRECONDITION_FAILED", { message: "Watches aren't switched on here yet.", data: { code: "WATCHES_OFF" } });
  return context.watches;
};

/**
 * A clinician's own watches (../watches): standing questions Sona asks once a day and answers on Today.
 * Each clinician sees and changes only their own. The app reads the spoken sentence with parseWatch
 * (@sona-ai/domain/watch) and shows it back for confirmation before calling create.
 */
export const watchesRouter = {
  list: protectedProcedure.handler(({ context }) => context.watches?.list(context.hospitalId, context.session.user.id) ?? []),
  /** Keeps a watch and asks it once now; replaying the requestId returns the same watch. */
  create: protectedProcedure.input(z.object({ requestId: z.string().min(1).max(64), question: z.string().trim().min(1).max(500), hour: z.number().int().min(0).max(23) }))
    .handler(async ({ context, input }) => {
      const watches = agents(context), userId = context.session.user.id;
      const kept = await watches.list(context.hospitalId, userId);
      if (kept.length >= MAX_WATCHES && !kept.some(w => w.id === input.requestId))
        throw new ORPCError("BAD_REQUEST", { message: `You can keep ${MAX_WATCHES} watches. Remove one first.` });
      return watches.add(context.hospitalId, userId, { id: input.requestId, question: input.question, hour: input.hour });
    }),
  remove: protectedProcedure.input(z.object({ watchId: z.string().min(1) }))
    .handler(({ context, input }) => agents(context).remove(context.hospitalId, context.session.user.id, input.watchId)),
};
