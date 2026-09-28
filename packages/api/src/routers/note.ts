import { notes } from "@sona-ai/db/schema/clinical";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { noteSaveSchema } from "../contracts";
import type { Context } from "../context";
import { protectedProcedure } from "../index";
import { loadEncounter, stale } from "./encounter";
import { captureNoteEdit } from "./training";

/**
 * The consultation note as revisions: nothing is overwritten, so an addendum or fix stays visible as
 * evidence. The unique (encounter, revision) index decides a race; the loser is told to reload.
 */
export async function latestNote(db: Context["db"], hospitalId: string, encounterId: string) {
  await loadEncounter(db, hospitalId, encounterId); // scopes the note to the caller's hospital
  const [row] = await db.select({ revision: notes.revision, sentences: notes.sentences }).from(notes)
    .where(eq(notes.encounterId, encounterId)).orderBy(desc(notes.revision)).limit(1);
  return { encounterId, revision: row?.revision ?? 0, sentences: row?.sentences ?? [] };
}

export const noteRouter = {
  get: protectedProcedure.input(z.object({ encounterId: z.string().min(1) }))
    .handler(({ context, input }) => latestNote(context.db, context.hospitalId, input.encounterId)),
  save: protectedProcedure.input(noteSaveSchema).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    const { encounterId, sentences, expectedRevision } = input;
    const current = await latestNote(db, hospitalId, encounterId);
    if (current.revision !== expectedRevision) throw stale(encounterId);
    const revision = expectedRevision + 1;
    const rows = await db.insert(notes).values({ id: `note-${encounterId}-${revision}`, encounterId, revision, sentences })
      .onConflictDoNothing().returning({ id: notes.id });
    if (!rows.length) throw stale(encounterId);
    // The scribe's draft and the saved note become a de-identified training sample (if consented); never fails the save.
    await captureNoteEdit(context, hospitalId, encounterId, sentences.map(s => s.text).join("\n"), input.excludeFromTraining);
    return { encounterId, revision, sentences };
  }),
};
