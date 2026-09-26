import type { RouterClient } from "@orpc/server";
import { tasks } from "@sona-ai/db/schema/clinical";
import { asc, eq } from "drizzle-orm";

import { openAuditItems } from "../audit-job";
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
  },
  tasks: {
    list: protectedProcedure.handler(({ context }) =>
      context.db.select().from(tasks).where(eq(tasks.hospitalId, context.hospitalId)).orderBy(asc(tasks.createdAt))),
  },
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
