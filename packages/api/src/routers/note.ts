import { notes } from "@sona-ai/db/schema/clinical";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { noteSaveSchema } from "../contracts";
import type { Context } from "../context";
import { protectedProcedure } from "../index";
import { stubModels } from "../models";
import { logAnswer, loadEncounter, stale } from "./encounter";
import { captureNoteEdit } from "./training";

/**
 * The consultation as heard: the speech model's parts in order, or the dialogue's turns once a draft has marked who
 * said what (a speaker is sent only where the clinician confirmed it). About 40 minutes of talk at most: Gemma reads 16k tokens.
 */
export const noteDraftSchema = z.object({
  encounterId: z.string().min(1),
  lines: z.array(z.object({ text: z.string().trim().min(1).max(4000), speaker: z.enum(["clinician", "patient", "family", "nurse", "interpreter", "other"]).optional(), voice: z.number().int().min(1).max(8).optional() })).min(1).max(600)
    .refine(lines => lines.reduce((n, l) => n + l.text.length, 0) <= 40_000, "This consultation is too long to draft in one go"),
});

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
    const sample = await captureNoteEdit(context, hospitalId, encounterId, sentences.map(s => s.text).join("\n"), input.excludeFromTraining);
    // `sample`, as on a check-in reply: who de-identified the training sample this save became, and whether the leak gate let it through (none without consent).
    return { encounterId, revision, sentences, ...sample && { sample } };
  }),
  /**
   * The scribe's draft of the visit's note from its consultation, for the doctor to review and edit before note.save:
   * Gemma's sections checked against the transcript (models.draftNote), or the captured words as they are, labelled fixture.
   * Nothing is saved here; the draft is logged in provenance like every model answer.
   */
  draft: protectedProcedure.input(noteDraftSchema).handler(async ({ context, input }) => {
    await loadEncounter(context.db, context.hospitalId, input.encounterId); // the caller's hospital only
    const answer = await (context.models ?? stubModels).draftNote({ lines: input.lines });
    return logAnswer(context.db, input.encounterId, "note-draft", answer, []);
  }),
};
