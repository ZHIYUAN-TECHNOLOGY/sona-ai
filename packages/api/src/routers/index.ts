import type { RouterClient } from "@orpc/server";
import { tasks } from "@sona-ai/db/schema/clinical";
import { asc, eq } from "drizzle-orm";

import { openAuditItems, queryAuditItem, runNightlyAudit } from "../audit-job";
import { clockOf } from "../context";
import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { protectedProcedure, publicProcedure } from "../index";
import { claimRouter } from "./claim";
import { completeTask, createTask, dayRouter, patientsRouter, resultsRouter } from "./day"; // lane T, T2
import { dischargeRouter } from "./discharge";
import { careRouter } from "./care";
import { carePlanRouter } from "./care-plan";
import { encounterRouter } from "./encounter";
import { evidenceRouter } from "./evidence";
import { wardRouter } from "./ward";
// lane P
import { noteRouter } from "./note";
import { prescribingRouter } from "./prescribing";
// lane H
import { handoverRouter } from "./handover";
import { xrayRouter } from "./xray";
// lane F7
import { checkInsRouter } from "./check-ins";
// lane F6
import { findingsRouter } from "./findings";
// lane U
import { libraryRouter } from "./library";

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
  // Sona Care, the patient app
  care: { ...careRouter, ...carePlanRouter },
  evidence: evidenceRouter,
  discharge: dischargeRouter,
  claim: claimRouter,
  ward: wardRouter,
  // lane T
  results: resultsRouter,
  day: dayRouter,
  patients: patientsRouter,
  // lane P
  prescribing: prescribingRouter,
  note: noteRouter,
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
  // lane H
  handover: handoverRouter,
  xray: xrayRouter,
  tasks: {
    list: protectedProcedure.handler(({ context }) =>
      context.db.select().from(tasks).where(eq(tasks.hospitalId, context.hospitalId)).orderBy(asc(tasks.createdAt))),
    complete: completeTask, // lane T
    create: createTask, // lane T2
  },
  // lane F7
  checkIns: checkInsRouter,
  // lane F6
  findings: findingsRouter,
  // lane U
  library: libraryRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
