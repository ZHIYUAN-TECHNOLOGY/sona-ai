import { ORPCError } from "@orpc/server";
import { user } from "@sona-ai/db/schema/auth";
import { admissions, careLinks, encounters, hospitals, patients, provenance, trainingConsents, trainingDatasets, trainingSamples } from "@sona-ai/db/schema/clinical";
import { leakGate, type IdentityKind, type KnownIdentity, type Replacement } from "@sona-ai/domain/training";
import { and, desc, eq, inArray, isNull, max, notInArray, sql } from "drizzle-orm";
import { z } from "zod";

import { clockOf, type Context } from "../context";
import { protectedProcedure } from "../index";
import { stubModels } from "../models";

/**
 * Continuous training without identity (docs/delivery-plan.md): consent → capture → de-identify →
 * leak gate → steward review → versioned export → (later) a Baseten fine-tune. Capture is automatic and
 * never fails the write that caused it. A sample holds only de-identified text; the raw note or reply
 * stays in its own table. It is captured only when the hospital contributes AND the patient consented.
 */
type Db = Context["db"];
type Source = "note-edit" | "check-in-reply" | "transcript";
export const SAMPLE_STATUSES = ["pending", "approved", "blocked", "excluded", "withdrawn"] as const;

/** The patient's own identifiers, as the de-identifier and the gate need them: name, IC (when the record has one), phone (their Sona Care account's), MRN. */
async function knownIdentity(db: Db, patientId: string): Promise<KnownIdentity> {
  const [row] = await db.select({ name: patients.name, record: patients.record }).from(patients).where(eq(patients.id, patientId));
  const [account] = await db.select({ phone: user.phoneNumber }).from(careLinks).innerJoin(user, eq(user.id, careLinks.userId)).where(eq(careLinks.patientId, patientId)).limit(1);
  const ic = (row?.record as { ic?: unknown } | undefined)?.ic;
  return { names: row ? [row.name] : [], mrn: patientId, ...typeof ic === "string" ? { ic } : {}, ...account?.phone ? { phone: account.phone } : {} };
}

async function consents(db: Db, hospitalId: string, patientId: string) {
  const [row] = await db.select({ contributes: hospitals.contributesTraining, consentedAt: trainingConsents.consentedAt, withdrawnAt: trainingConsents.withdrawnAt })
    .from(hospitals).leftJoin(trainingConsents, and(eq(trainingConsents.hospitalId, hospitals.id), eq(trainingConsents.patientId, patientId)))
    .where(eq(hospitals.id, hospitalId));
  return Boolean(row?.contributes && row.consentedAt && !row.withdrawnAt);
}

/** De-identifies both sides, then gates them: any hit blocks the sample and masks what leaked, so the value is never stored. */
async function prepare(context: Pick<Context, "db" | "models">, patientId: string, input: string, output: string) {
  const known = await knownIdentity(context.db, patientId);
  const models = context.models ?? stubModels;
  const [a, b] = await Promise.all([models.deidentify({ text: input, known }), models.deidentify({ text: output, known })]);
  const [ga, gb] = [leakGate(a.text, known), leakGate(b.text, known)];
  const leak = [...new Set([...ga.kinds, ...gb.kinds])];
  return {
    input: ga.masked, output: gb.masked, replacements: [...a.replacements, ...b.replacements],
    deidentifier: a.source === "model" ? a.model : "rules", status: leak.length ? "blocked" as const : "pending" as const, leak: leak.length ? leak : null,
  };
}

/**
 * Records one sample when the hospital contributes and the patient consented; otherwise nothing. A
 * sample with the same id (a note saved again) is re-captured unless it was already exported, excluded or withdrawn.
 * Never throws: a failed capture is logged and dropped.
 */
export async function captureSample(context: Context, sample: { id: string; hospitalId: string; patientId: string; source: Source; sourceRef: string; input: string; output: string }) {
  try {
    if (!await consents(context.db, sample.hospitalId, sample.patientId)) return;
    const clean = await prepare(context, sample.patientId, sample.input, sample.output);
    const row = { ...sample, ...clean, createdAt: clockOf(context) };
    await context.db.insert(trainingSamples).values(row).onConflictDoUpdate({
      target: trainingSamples.id, set: { input: row.input, output: row.output, replacements: row.replacements, deidentifier: row.deidentifier, status: row.status, leak: row.leak, createdAt: row.createdAt },
      setWhere: and(isNull(trainingSamples.datasetVersion), notInArray(trainingSamples.status, ["excluded", "withdrawn"])),
    });
  } catch (error) {
    console.error("training capture failed", error);
  }
}

/**
 * The scribe's authored draft of Amelia's scripted consultation (apps/native englishTranscript), as the
 * ambient scribe writes it: it calls her by her first name, which the rule-based de-identifier misses
 * and the leak gate catches. ponytail: the scribe runs in the app for now; once it runs on the server
 * its drafts are logged to provenance as `note-draft` and this fixture goes.
 */
const AUTHORED_DRAFTS: Record<string, string> = {
  "visit-1042": "Amelia reports a cough for about five days, with fever since yesterday. Family history of maternal asthma. Uses a reliever inhaler as needed; ingredient to be reconciled.",
};

/** The scribe's AI draft for a visit: the latest `note-draft` in provenance (every AI output is logged there), else the authored one. */
export async function noteDraftOf(db: Db, encounterId: string) {
  const [row] = await db.select({ output: provenance.output }).from(provenance)
    .where(and(eq(provenance.encounterId, encounterId), eq(provenance.kind, "note-draft"))).orderBy(desc(provenance.createdAt)).limit(1);
  const text = (row?.output as { text?: unknown } | undefined)?.text;
  return typeof text === "string" && text.trim() ? text : AUTHORED_DRAFTS[encounterId];
}

/** note.save: the draft the doctor started from, and the note they saved. `exclude` takes this visit's note out instead. */
export async function captureNoteEdit(context: Context, hospitalId: string, encounterId: string, saved: string, exclude?: boolean) {
  const id = `note-edit:${encounterId}`;
  try {
    if (exclude) {
      await context.db.update(trainingSamples).set({ status: "excluded" }).where(and(eq(trainingSamples.id, id), isNull(trainingSamples.datasetVersion)));
      return;
    }
    const draft = await noteDraftOf(context.db, encounterId);
    const [visit] = await context.db.select({ patientId: encounters.patientId }).from(encounters).where(and(eq(encounters.id, encounterId), eq(encounters.hospitalId, hospitalId)));
    if (!draft || !visit) return;
    await captureSample(context, { id, hospitalId, patientId: visit.patientId, source: "note-edit", sourceRef: encounterId, input: draft, output: saved });
  } catch (error) {
    console.error("training capture failed", error);
  }
}

/** Who a sample is about, without saying who: their bed, or a short hash of the record ID. */
function labelFor(patientId: string, bed?: string | null) {
  if (bed) return `Patient in ${bed}`;
  let h = 2166136261;
  for (const c of patientId) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return `Patient ${(h >>> 0).toString(16).padStart(8, "0").slice(0, 4)}`;
}

type SampleRow = typeof trainingSamples.$inferSelect;
const view = (s: SampleRow, bed?: string | null) => ({
  id: s.id, source: s.source, input: s.input, output: s.output, replacements: s.replacements as Replacement[], status: s.status,
  leak: s.leak as IdentityKind[] | null, patientLabel: labelFor(s.patientId, bed),
});

async function samplesOf(db: Db, hospitalId: string, where?: ReturnType<typeof eq>) {
  // ponytail: newest 200; page when a hospital's review queue outgrows that.
  const rows = await db.select().from(trainingSamples).where(and(eq(trainingSamples.hospitalId, hospitalId), where)).orderBy(desc(trainingSamples.createdAt)).limit(200);
  const beds = rows.length ? await db.select({ patientId: admissions.patientId, bed: admissions.bed }).from(admissions)
    .where(and(eq(admissions.hospitalId, hospitalId), inArray(admissions.patientId, [...new Set(rows.map(r => r.patientId))]))) : [];
  return rows.map(r => view(r, beds.find(b => b.patientId === r.patientId)?.bed));
}

const refuse = (code: string, message: string, status: "CONFLICT" | "PRECONDITION_FAILED" | "NOT_FOUND" = "CONFLICT") => new ORPCError(status, { message, data: { code } });

export const trainingRouter = {
  /** Management: whether the hospital contributes, the review queue by status, the last export and who de-identifies. */
  status: protectedProcedure.handler(async ({ context: { db, hospitalId } }) => {
    const [hospital] = await db.select({ contributes: hospitals.contributesTraining }).from(hospitals).where(eq(hospitals.id, hospitalId));
    const grouped = await db.select({ status: trainingSamples.status, n: sql<number>`count(*)::int` }).from(trainingSamples).where(eq(trainingSamples.hospitalId, hospitalId)).groupBy(trainingSamples.status);
    const counts = Object.fromEntries(SAMPLE_STATUSES.map(s => [s, grouped.find(g => g.status === s)?.n ?? 0])) as Record<(typeof SAMPLE_STATUSES)[number], number>;
    const [last] = await db.select().from(trainingDatasets).where(eq(trainingDatasets.hospitalId, hospitalId)).orderBy(desc(trainingDatasets.version)).limit(1);
    const [latest] = await db.select({ deidentifier: trainingSamples.deidentifier }).from(trainingSamples).where(eq(trainingSamples.hospitalId, hospitalId)).orderBy(desc(trainingSamples.createdAt)).limit(1);
    return {
      contributes: hospital?.contributes ?? false, counts,
      lastDataset: last ? { version: last.version, rows: last.rows, exportedAt: last.exportedAt } : null,
      deidentifier: latest?.deidentifier ?? "rules",
    };
  }),
  /** Management: switch the hospital's contribution on or off (off stops capture; samples already taken stay for review). */
  setContributes: protectedProcedure.input(z.object({ contributes: z.boolean() })).handler(async ({ context: { db, hospitalId }, input }) => {
    await db.update(hospitals).set({ contributesTraining: input.contributes }).where(eq(hospitals.id, hospitalId));
    return { contributes: input.contributes };
  }),
  /** Management: samples newest first, de-identified text only, each labelled by bed or a short hash (never the name). */
  samples: protectedProcedure.input(z.object({ status: z.enum(SAMPLE_STATUSES).optional() }).optional())
    .handler(({ context: { db, hospitalId }, input }) => samplesOf(db, hospitalId, input?.status ? eq(trainingSamples.status, input.status) : undefined)),
  /** Management: approve or exclude a sample. A blocked sample cannot be approved; a withdrawn or exported one is settled. */
  decide: protectedProcedure.input(z.object({ id: z.string().min(1), decision: z.enum(["approve", "exclude"]) })).handler(async ({ context: { db, hospitalId }, input }) => {
    const [row] = await db.select().from(trainingSamples).where(and(eq(trainingSamples.id, input.id), eq(trainingSamples.hospitalId, hospitalId)));
    if (!row) throw refuse("SAMPLE_UNKNOWN", "That sample was not found", "NOT_FOUND");
    if (row.datasetVersion !== null) throw refuse("SAMPLE_EXPORTED", "That sample is already in an exported dataset");
    if (row.status === "withdrawn") throw refuse("SAMPLE_WITHDRAWN", "The patient withdrew consent for that sample");
    if (row.status === "blocked" && input.decision === "approve") throw refuse("SAMPLE_BLOCKED", "The leak gate blocked that sample; exclude it instead");
    const status = input.decision === "approve" ? "approved" as const : "excluded" as const;
    await db.update(trainingSamples).set({ status }).where(eq(trainingSamples.id, row.id));
    return (await samplesOf(db, hospitalId, eq(trainingSamples.id, row.id)))[0]!;
  }),
  /**
   * Management: every approved, not-yet-exported sample as the next dataset version, JSONL
   * `{source, input, output}` in R2 at training/<hospital>/v<version>.jsonl. The leak gate runs again
   * first: any hit aborts the export (LEAK_FOUND) and blocks the samples it found.
   */
  export: protectedProcedure.handler(async ({ context }) => {
    const { db, hospitalId } = context;
    const rows = await db.select().from(trainingSamples)
      .where(and(eq(trainingSamples.hospitalId, hospitalId), eq(trainingSamples.status, "approved"), isNull(trainingSamples.datasetVersion))).orderBy(trainingSamples.createdAt);
    if (!rows.length) throw refuse("NOTHING_TO_EXPORT", "No approved samples are waiting to export", "PRECONDITION_FAILED");
    const known = new Map<string, KnownIdentity>();
    for (const id of new Set(rows.map(r => r.patientId))) known.set(id, await knownIdentity(db, id));
    const leaks = rows.map(r => ({ r, input: leakGate(r.input, known.get(r.patientId)!), output: leakGate(r.output, known.get(r.patientId)!) }))
      .filter(x => x.input.kinds.length || x.output.kinds.length);
    if (leaks.length) {
      for (const { r, input, output } of leaks)
        await db.update(trainingSamples).set({ status: "blocked", input: input.masked, output: output.masked, leak: [...new Set([...input.kinds, ...output.kinds])] }).where(eq(trainingSamples.id, r.id));
      throw refuse("LEAK_FOUND", `The leak gate found identity in ${leaks.length} approved sample${leaks.length === 1 ? "" : "s"}; they are blocked and nothing was exported`, "PRECONDITION_FAILED");
    }
    if (!context.uploads) throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Dataset storage is not configured" });
    const [{ last }] = await db.select({ last: max(trainingDatasets.version) }).from(trainingDatasets).where(eq(trainingDatasets.hospitalId, hospitalId)) as [{ last: number | null }];
    const version = (last ?? 0) + 1, key = `training/${hospitalId}/v${version}.jsonl`;
    const jsonl = rows.map(r => JSON.stringify({ source: r.source, input: r.input, output: r.output })).join("\n") + "\n";
    await context.uploads.put(key, new TextEncoder().encode(jsonl), { httpMetadata: { contentType: "application/x-ndjson" } });
    // The dataset row first: its (hospital, version) key refuses a racing export of the same version.
    await db.insert(trainingDatasets).values({ hospitalId, version, rows: rows.length, r2Key: key, exportedAt: clockOf(context) });
    await db.update(trainingSamples).set({ datasetVersion: version }).where(inArray(trainingSamples.id, rows.map(r => r.id)));
    return { version, rows: rows.length, key };
  }),
};

/** Sona Care: the patient's own choice (off until they switch it on). `at` is when they consented, or when they withdrew. */
export async function trainingConsentOf(db: Db, hospitalId: string, patientId: string) {
  const [row] = await db.select().from(trainingConsents).where(and(eq(trainingConsents.hospitalId, hospitalId), eq(trainingConsents.patientId, patientId)));
  const consented = Boolean(row?.consentedAt && !row.withdrawnAt);
  return { consented, at: (consented ? row?.consentedAt : row?.withdrawnAt) ?? null };
}

/** Consenting (again) clears a withdrawal; withdrawing marks every sample not yet exported as withdrawn. */
export async function setTrainingConsent(context: Context, hospitalId: string, patientId: string, consented: boolean) {
  const { db } = context, now = clockOf(context);
  const set = consented ? { consentedAt: now, withdrawnAt: null } : { withdrawnAt: now };
  await db.insert(trainingConsents).values({ hospitalId, patientId, consentedAt: consented ? now : null, withdrawnAt: consented ? null : now })
    .onConflictDoUpdate({ target: [trainingConsents.patientId, trainingConsents.hospitalId], set });
  if (!consented) await db.update(trainingSamples).set({ status: "withdrawn" })
    .where(and(eq(trainingSamples.hospitalId, hospitalId), eq(trainingSamples.patientId, patientId), isNull(trainingSamples.datasetVersion)));
  return trainingConsentOf(db, hospitalId, patientId);
}
