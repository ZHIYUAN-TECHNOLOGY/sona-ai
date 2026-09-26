import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";
import { changeFor } from "./events";
import { hospitalOf } from "./routers/hospital";

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next, path }, input) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  // Every clinical read and write below is scoped to this hospital.
  const hospitalId = await hospitalOf(context.db, context.session.user.id);
  const result = await next({
    context: {
      session: context.session,
      hospitalId,
    },
  });
  // A write that succeeded is announced to the hospital's connected apps; a failed announcement never fails the write.
  const change = changeFor(path, input);
  if (change && context.announce) await context.announce(hospitalId, change).catch(() => {});
  return result;
});

export const protectedProcedure = publicProcedure.use(requireAuth);
