import type { RouterClient } from "@orpc/server";
import { tasks } from "@sona-ai/db/schema/clinical";
import { and, asc, eq } from "drizzle-orm";
import { taskUpdateSchema } from "../contracts";

import { openAuditItems, queryAuditItem, runNightlyAudit } from "../audit-job";
import { clockOf } from "../context";
import { stubModels } from "../models";
import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { protectedProcedure, publicProcedure } from "../index";
import { accessLogRouter, clinicianRouter } from "./access-log";
import { claimRouter } from "./claim";
import { completeTask, createTask, dayRouter, patientsRouter, resultsRouter } from "./day"; // lane T, T2
import { demoRouter } from "./demo";
import { adherenceRouter } from "./doses";
import { opsRouter } from "./ops";
import { dischargeRouter } from "./discharge";
import { bookingsRouter, careBookingsRouter, careDoctorsRouter } from "./bookings";
import { careRouter, MAX_AUDIO_BASE64 } from "./care";
import { carePlanRouter } from "./care-plan";
import { careReadingsRouter } from "./care-readings";
import { careResultsRouter } from "./care-results";
import { messagesRouter } from "./messages";
import { careVisitSummariesRouter, reviewRouter } from "./review";
import { encounterRouter } from "./encounter";
import { evidenceRouter } from "./evidence";
import { careHealthSummary, proHealthSummary } from "./health-summary";
import { wardRouter } from "./ward";
// lane P
import { noteRouter } from "./note";
import { prescribingRouter } from "./prescribing";
// lane H
import { handoverRouter } from "./handover";
import { xrayRouter } from "./xray";
import { scanRouter } from "./scan";
// lane F7
import { checkInsRouter } from "./check-ins";
// lane F6
import { findingsRouter } from "./findings";
// lane U
import { libraryRouter } from "./library";
import { trainingRouter } from "./training";
import { askRouter } from "./ask";
import { watchesRouter } from "./watches";

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
  // Roles and the PDPA access trail: who is signed in as what, and who opened a patient's record.
  clinician: clinicianRouter,
  accessLog: accessLogRouter,
  encounter: encounterRouter,
  // The demo clock (synthetic demo hospital only): jump to day 2, day 7 or the review, and back.
  demo: demoRouter,
  // Sona Care doses taken, read by the care team (flagged rows on My Day say what was missed).
  adherence: adherenceRouter,
  // Management: this week's numbers from the loops' own rows (the ops counter on the ward view).
  ops: opsRouter,
  // Sona Care, the patient app; `messages` is the care team's side of its thread (announced as "messages")
  care: { ...careRouter, ...carePlanRouter, ...careReadingsRouter, doctors: careDoctorsRouter, bookings: careBookingsRouter, results: careResultsRouter, visitSummaries: careVisitSummariesRouter, healthSummary: careHealthSummary },
  review: reviewRouter,
  // Booking requests from Sona Care (confirm or decline on My Day) and free slots for Book in.
  bookings: bookingsRouter,
  messages: messagesRouter,
  evidence: evidenceRouter,
  discharge: dischargeRouter,
  claim: claimRouter,
  ward: wardRouter,
  // lane T
  results: resultsRouter,
  day: dayRouter,
  // summary: the health summary PDF a hospital sends to another on transfer (Sona Care has its own, care.healthSummary).
  patients: { ...patientsRouter, summary: proHealthSummary },
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
  // Scan a handwritten note: photo → reading (a proposal) → the doctor's reviewed items into the record.
  scan: scanRouter,
  tasks: {
    list: protectedProcedure.handler(({ context }) =>
      context.db.select().from(tasks).where(eq(tasks.hospitalId, context.hospitalId)).orderBy(asc(tasks.createdAt))),
    complete: completeTask, // lane T
    create: createTask, // lane T2
    /** Reassigns and/or redates one of the hospital's tasks in place. */
    update: protectedProcedure.input(taskUpdateSchema).handler(async ({ context: { db, hospitalId }, input }) => {
      const [task] = await db.update(tasks).set({ ...input.owner !== undefined ? { owner: input.owner } : {}, ...input.due !== undefined ? { due: input.due } : {} })
        .where(and(eq(tasks.id, input.taskId), eq(tasks.hospitalId, hospitalId))).returning();
      if (!task) throw new ORPCError("NOT_FOUND", { message: `No task ${input.taskId}` });
      return task;
    }),
  },
  // lane F7
  checkIns: checkInsRouter,
  // lane F6
  findings: findingsRouter,
  // lane U
  library: libraryRouter,
  // Continuous training: de-identified samples, steward review and versioned exports (management only).
  training: trainingRouter,
  /**
   * Clinician: speech to text for Sona's dock (Malay, English, Chinese or mixed). The app shows or sends
   * the words; audio is read and dropped, never stored. Refused while no speech model answers, with a
   * reason the dock shows (the stub has no ears).
   */
  voice: {
    transcribe: protectedProcedure.input(z.object({ audio: z.string().min(16).max(MAX_AUDIO_BASE64), language: z.enum(["en", "ms", "zh"]).optional(), voices: z.object({ memory: z.string().max(1_000_000).optional() }).optional() }))
      .handler(async ({ context, input }) => {
        const heard = await (context.models ?? stubModels).transcribe({ audio: Uint8Array.from(atob(input.audio), c => c.charCodeAt(0)), language: input.language, voices: input.voices });
        if (heard.source === "fixture") throw new ORPCError("PRECONDITION_FAILED", {
          message: heard.waking ? `The speech model is starting (about ${heard.waking} min). Try again then, or type.`
            : context.models ? "The speech model is starting. Try again in a minute, or type." : "Speaking to Sona isn't switched on yet. Type instead.",
          data: { code: "SPEECH_OFF" },
        });
        return heard;
      }),
  },
  // Sona's ask bar on the models: Laya routes a visit request, Gemma answers a page's free question from its own data.
  ask: askRouter,
  // A clinician's own standing questions, asked daily by their watch agent and answered like the ask bar.
  watches: watchesRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
