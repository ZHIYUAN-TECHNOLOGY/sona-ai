import { ORPCError } from "@orpc/server";
import { notes, provenance, tasks } from "@sona-ai/db/schema/clinical";
import { defaultMedications } from "@sona-ai/domain/prescribing";
import { appendSections, mergeMedicines, noteSections, noteSentences, scanDoneLine, SCAN_SECTION_KEYS, type HandwrittenNote } from "@sona-ai/domain/scan";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { SAMPLE_SCAN_KEY, scanApplySchema, scanUploadSchema } from "../contracts";
import type { Context } from "../context";
import { stubModels } from "../models";
import { protectedProcedure } from "../index";
import { editEncounter, loadEncounter, stale, visitOf } from "./encounter";
import { latestNote } from "./note";
import { captureSample } from "./training";
import { bucket } from "./xray";

/**
 * Scan a handwritten note (doctors only): upload the photo, read it through the model seam, then apply
 * only what the doctor kept after review. Reading writes nothing but its provenance; apply appends to
 * the note (a new revision, never replacing a section), proposes medicine changes unconfirmed, creates
 * the tasks, and records that all of it came from a scanned note (the image key).
 */
type Applied = { noteRevision?: number; sections: number; medicines: number; tasks: number; line: string };

/** Only this hospital's scans (or the bundled sample) can be read or cited. */
function checkKey(hospitalId: string, key: string) {
  if (key !== SAMPLE_SCAN_KEY && !key.startsWith(`scans/${hospitalId}/`)) throw new ORPCError("NOT_FOUND", { message: "No such scan" });
}
const readId = (encounterId: string, key: string) => `scan-read:${encounterId}:${key}`;

export const scanRouter = {
  upload: protectedProcedure.input(scanUploadSchema).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    await loadEncounter(db, hospitalId, input.encounterId);
    const key = `scans/${hospitalId}/${crypto.randomUUID()}.${input.contentType === "image/png" ? "png" : "jpg"}`;
    const bytes = Uint8Array.from(atob(input.dataBase64), c => c.charCodeAt(0));
    await bucket(context).put(key, bytes, { httpMetadata: { contentType: input.contentType } });
    return { key };
  }),

  /** The model's reading of the photo, as a proposal: nothing in the record changes. */
  read: protectedProcedure.input(z.object({ encounterId: z.string().min(1), key: z.string().min(1) })).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    checkKey(hospitalId, input.key);
    const { patient } = await visitOf(db, hospitalId, input.encounterId);
    const sample = input.key === SAMPLE_SCAN_KEY;
    const object = sample ? undefined : await bucket(context).get(input.key);
    if (!sample && !object) throw new ORPCError("NOT_FOUND", { message: "No such scan" });
    // The bundled sample is always the fixture's reading; a photo goes to whichever model the Worker passed.
    const models = sample ? stubModels : context.models ?? stubModels;
    // Nothing identifying leaves for a real model: the name goes through the de-identify seam first.
    // ponytail: the handwriting in the photo can still name the patient; a Baseten deployment in our own tenancy is the boundary for pixels.
    const name = models === stubModels ? patient.name : (await models.deidentify({ text: patient.name, known: { names: [patient.name], mrn: patient.id } })).text;
    const reading = await models.readHandwrittenNote({
      image: object ? new Uint8Array(await object.arrayBuffer()) : new Uint8Array(), contentType: object?.httpMetadata?.contentType ?? "image/png",
      patient: { name, knownMedicines: patient.medicines },
    });
    const model = reading.source === "model" ? reading.model : "fixture";
    const { source: _, ...output } = reading as HandwrittenNote & { source: string; model?: string };
    await db.insert(provenance).values({ id: readId(input.encounterId, input.key), encounterId: input.encounterId, kind: "scan-read", output, sourceIds: [input.key], model, approvedBy: null })
      .onConflictDoUpdate({ target: provenance.id, set: { output, model } });
    return reading;
  }),

  /** Writes only what the doctor kept; replaying the requestId returns the first result and writes nothing again. */
  apply: protectedProcedure.input(scanApplySchema).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    const { encounterId, key } = input;
    checkKey(hospitalId, key);
    const { patient } = await visitOf(db, hospitalId, encounterId);
    const receiptId = `scan-apply:${encounterId}:${input.requestId}`;
    const [done] = await db.select({ output: provenance.output }).from(provenance).where(eq(provenance.id, receiptId));
    if (done) return (done.output as { result: Applied }).result;
    const from = `From a scanned handwritten note (${key})`;

    // The note: a new revision with the kept sections appended under what is already there.
    const sections = Object.fromEntries(SCAN_SECTION_KEYS.flatMap(k => input.sections?.[k]?.trim() ? [[k, input.sections[k]!.trim()]] : []));
    const sectionCount = Object.keys(sections).length;
    let noteRevision: number | undefined;
    if (sectionCount) {
      const current = await latestNote(db, hospitalId, encounterId);
      noteRevision = current.revision + 1;
      const sentences = noteSentences(appendSections(noteSections(current.sentences), sections));
      const rows = await db.insert(notes).values({ id: `note-${encounterId}-${noteRevision}`, encounterId, revision: noteRevision, sentences })
        .onConflictDoNothing().returning({ id: notes.id });
      if (!rows.length) throw stale(encounterId);
    }

    // Medicine changes join reconciliation unconfirmed (this bumps the visit and invalidates its review).
    const changes = (input.medicines ?? []).filter(m => m.change !== "continue");
    if (changes.length) {
      const { revision, state } = await loadEncounter(db, hospitalId, encounterId);
      await editEncounter(context, hospitalId, { encounterId, expectedRevision: revision, medicationEntries: mergeMedicines(state.medicationEntries ?? defaultMedications(patient), changes, from) });
    }

    // Tasks, and the follow-up as a task to book it.
    const todo = [
      ...(input.tasks ?? []).map(t => ({ title: t.title, owner: t.owner || "Attending doctor", due: t.due || null })),
      ...input.followUp ? [{ title: `Book follow-up in ${input.followUp.in}`, owner: "Attending doctor", due: input.followUp.in }] : [],
    ];
    if (todo.length) await db.insert(tasks).values(todo.map((t, i) => ({ id: `scan:${encounterId}:${input.requestId}:${i}`, hospitalId, encounterId, kind: "followup" as const, ...t, sourceId: receiptId, idempotencyKey: `scan:${encounterId}:${input.requestId}:${i}` })))
      .onConflictDoNothing();

    const result: Applied = { noteRevision, sections: sectionCount, medicines: changes.length, tasks: todo.length, line: scanDoneLine({ sections: sectionCount, medicines: changes.length, tasks: todo.length }) };
    const [read] = await db.select({ output: provenance.output, model: provenance.model }).from(provenance).where(eq(provenance.id, readId(encounterId, key)));
    await db.insert(provenance).values({
      id: receiptId, encounterId, kind: "scan-apply", sourceIds: [key], model: read?.model ?? "fixture", approvedBy: context.session.user.id,
      output: { result, from, applied: { sections, medicines: input.medicines ?? [], tasks: todo } },
    }).onConflictDoNothing();
    // The model's reading and what the doctor kept become a de-identified training sample (if consented); never fails the apply.
    const reading = (read?.output as { text?: unknown } | undefined)?.text;
    if (typeof reading === "string" && sectionCount) await captureSample(context as Context, {
      id: `handwritten-scan:${encounterId}:${key}`, hospitalId, patientId: patient.id, source: "handwritten-scan", sourceRef: key,
      input: reading, output: Object.values(sections).join("\n"),
    });
    await context.announce?.(hospitalId, { topic: "visit", encounterId }).catch(() => {});
    return result;
  }),
};
