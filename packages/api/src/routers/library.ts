import { ORPCError } from "@orpc/server";
import { documents } from "@sona-ai/db/schema/clinical";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import type { Context } from "../context";
import { protectedProcedure } from "../index";

/**
 * A hospital's own library: a doctor adds a guideline or reference text (plain text or markdown),
 * it is cut into sections and searched alongside the shared library, and only that hospital sees it.
 */
const libraryOf = (context: Context) => {
  if (!context.library) throw new ORPCError("SERVICE_UNAVAILABLE", { message: "The library is not available on this server" });
  return context.library;
};

export const libraryRouter = {
  /** Replay-safe: the document ID comes from the request, so a retried add replaces rather than duplicates. */
  add: protectedProcedure.input(z.object({
    requestId: z.string().min(1).max(100), title: z.string().trim().min(1).max(200), source: z.string().trim().min(1).max(200),
    year: z.number().int().min(1900).max(2100), license: z.string().trim().max(200).optional(), text: z.string().trim().min(1).max(200_000),
  })).handler(async ({ context, input }) => {
    const doc = { id: `${context.hospitalId}:${input.requestId}`, hospitalId: context.hospitalId, title: input.title, source: input.source, year: input.year, license: input.license ?? null, uploadedBy: context.session.user.id };
    await libraryOf(context).ingest(doc, input.text);
    return doc;
  }),
  list: protectedProcedure.handler(({ context }) =>
    context.db.select({ id: documents.id, title: documents.title, source: documents.source, year: documents.year, license: documents.license, uploadedBy: documents.uploadedBy, createdAt: documents.createdAt })
      .from(documents).where(eq(documents.hospitalId, context.hospitalId)).orderBy(desc(documents.createdAt))),
  /** Deletes one of the hospital's own documents; its sections go with it. */
  remove: protectedProcedure.input(z.object({ documentId: z.string().min(1) })).handler(async ({ context, input }) => {
    const [gone] = await context.db.delete(documents).where(and(eq(documents.id, input.documentId), eq(documents.hospitalId, context.hospitalId))).returning({ id: documents.id });
    if (!gone) throw new ORPCError("NOT_FOUND", { message: `No document ${input.documentId} in your library` });
    return gone;
  }),
};
