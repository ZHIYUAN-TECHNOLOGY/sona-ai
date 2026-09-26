import type { RouterClient } from "@orpc/server";
import { tasks } from "@sona-ai/db/schema/clinical";
import { asc, eq } from "drizzle-orm";

import { openAuditItems, queryAuditItem, runNightlyAudit } from "../audit-job";
import { clockOf } from "../context";
import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { protectedProcedure, publicProcedure } from "../index";
import { claimRouter } from "./claim";
import { dischargeRouter } from "./discharge";
import { encounterRouter } from "./encounter";
import { wardRouter } from "./ward";

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
  claim: claimRouter,
  ward: wardRouter,
  audit: {
    list: protectedProcedure.handler(({ context }) => openAuditItems(context.db, context.hospitalId)),
    /** Runs the nightly audit now for the caller's hospital (the demo does not wait for 02:00). */
    run: protectedProcedure.handler(({ context }) => runNightlyAudit(context.db, context.hospitalId, clockOf(context))),
    query: protectedProcedure.input(z.object({ itemId: z.string().min(1) })).handler(async ({ context, input }) => {
      const item = await queryAuditItem(context.db, context.hospitalId, input.itemId);
      if (!item) throw new ORPCError("NOT_FOUND", { message: `No audit item ${input.itemId}` });
      return item;
    }),
  },
  tasks: {
    list: protectedProcedure.handler(({ context }) =>
      context.db.select().from(tasks).where(eq(tasks.hospitalId, context.hospitalId)).orderBy(asc(tasks.createdAt))),
  },
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
