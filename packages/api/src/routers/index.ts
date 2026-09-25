import { ORPCError, type RouterClient } from "@orpc/server";
import { tasks } from "@sona-ai/db/schema/clinical";
import { wardBeds } from "@sona-ai/domain/ward";
import { asc, eq } from "drizzle-orm";

import { assignOwnerSchema } from "../contracts";
import { protectedProcedure, publicProcedure } from "../index";
import { dischargeRouter } from "./discharge";
import { encounterRouter } from "./encounter";
import { hospitalOf } from "./hospital";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),
  privateData: protectedProcedure.handler(({ context }) => {
    return {
      message: "This is private",
      user: context.session?.user,
    };
  }),
  encounter: encounterRouter,
  discharge: dischargeRouter,
  ward: {
    assignOwner: protectedProcedure.input(assignOwnerSchema).handler(async ({ context, input }) => {
      // ponytail: the blocker catalogue is the authored ward (demo bed at its starting state); derive it from admissions once beds are rows.
      const bed = wardBeds([], {}).find(b => b.blockers.some(x => x.id === input.blockerId));
      const blocker = bed?.blockers.find(x => x.id === input.blockerId);
      if (!bed || !blocker) throw new ORPCError("NOT_FOUND", { message: `No ward blocker ${input.blockerId}` });
      const hospitalId = hospitalOf(context.session);
      const [task] = await context.db.insert(tasks)
        .values({ id: crypto.randomUUID(), hospitalId, kind: "blocker-owner", title: `${bed.bed}: ${blocker.label}`, owner: input.owner, sourceId: blocker.id, idempotencyKey: `blocker-owner:${hospitalId}:${blocker.id}` })
        .onConflictDoUpdate({ target: tasks.idempotencyKey, set: { owner: input.owner } })
        .returning();
      return task!;
    }),
  },
  tasks: {
    list: protectedProcedure.handler(({ context }) =>
      context.db.select().from(tasks).where(eq(tasks.hospitalId, hospitalOf(context.session))).orderBy(asc(tasks.createdAt))),
  },
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
