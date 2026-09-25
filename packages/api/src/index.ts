import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";
import { hospitalOf } from "./routers/hospital";

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  // Every clinical read and write below is scoped to this hospital.
  const hospitalId = await hospitalOf(context.db, context.session.user.id);
  return next({
    context: {
      session: context.session,
      hospitalId,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireAuth);
