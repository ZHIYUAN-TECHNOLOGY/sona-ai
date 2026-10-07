import { ORPCError } from "@orpc/server";
import { encounters, findings, followUpRules, imageVectors, patients, provenance } from "@sona-ai/db/schema/clinical";
import { and, asc, cosineDistance, desc, eq, inArray, isNotNull, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { answerOnce } from "../answers";
import { xrayUploadSchema } from "../contracts";
import { clockOf, type Context } from "../context";
import { stubModels } from "../models";
import { protectedProcedure } from "../index";
import { loadEncounter } from "./encounter";
import { testOf } from "./findings";
import { base64Of } from "./library";

export const bucket = (context: Pick<Context, "uploads">) => {
  if (!context.uploads) throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Image storage is not configured" });
  return context.uploads;
};

type Db = Context["db"];
type Film = { key: string; contentType: string; uploadedAt: string };
/** "3 Oct 2026": the day in Malaysia. */
const day = (at: Date) => at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" });
/** What a Malay or Manglish (or Chinese) question calls each kind of finding, so it finds the film. */
const TERMS: Record<typeof findings.$inferSelect["kind"], string> = { nodule: "nodule / nodul / 结节", cardiomegaly: "cardiomegaly / jantung membesar / 心脏肥大", effusion: "effusion / efusi pleura / 胸腔积液" };
/** Films a patient's record tells of: the latest three. */
const FILMS_MAX = 3;

/**
 * The visits (of one patient, or one visit) that hold a film, newest film first, each as the line the record reads:
 * the film's date, the latest reading a model stored (xray.read's "xray-read" in provenance; the stub's is never a
 * model's, so a film it alone read is "not yet read by a model"), then the findings detected on it with their status
 * and follow-up. A fixture's findings are said to be a demo reading.
 */
async function filmsOf(db: Db, hospitalId: string, where: SQL) {
  const visits = await db.select({ id: encounters.id, patientId: patients.id, name: patients.name, state: encounters.state }).from(encounters).innerJoin(patients, eq(patients.id, encounters.patientId))
    .where(and(eq(encounters.hospitalId, hospitalId), where, isNotNull(sql`${encounters.state}->'xray'`))).orderBy(desc(sql`${encounters.state}->'xray'->>'uploadedAt'`)).limit(FILMS_MAX);
  if (!visits.length) return [];
  const ids = visits.map(v => v.id);
  const [reads, found] = await Promise.all([
    db.select({ encounterId: provenance.encounterId, output: provenance.output }).from(provenance)
      .where(and(inArray(provenance.encounterId, ids), eq(provenance.kind, "xray-read"), ne(provenance.model, "fixture"))).orderBy(desc(provenance.createdAt)),
    db.select({ finding: findings, action: followUpRules.action }).from(findings).leftJoin(followUpRules, eq(followUpRules.id, findings.ruleId))
      .where(inArray(findings.encounterId, ids)).orderBy(asc(findings.riskBand), asc(findings.id)),
  ]);
  return visits.map(v => {
    const film = (v.state as { xray: Film }).xray, at = new Date(film.uploadedAt);
    const read = reads.find(r => r.encounterId === v.id);
    const marks = found.filter(f => f.finding.encounterId === v.id);
    const lines = marks.map(({ finding: f, action }) => `${f.label}${f.sizeMm ? ` ${f.sizeMm} mm` : ""}, ${f.location.zone} (${[f.status, f.dueAt && `${testOf(action)} due ${day(f.dueAt)}`, f.source === "fixture" && "demo reading"].filter(Boolean).join(", ")})`);
    const reading = read ? (read.output as { findings: string[] }).findings.join("; ") : "not yet read by a model";
    return { ...v, film, at, kinds: [...new Set(marks.map(m => m.finding.kind))], line: `Chest X-ray (${day(at)}): ${reading}${lines.length ? `; findings: ${lines.join("; ")}` : ""}` };
  });
}

/** The X-ray lines of a patient's record (recordFacts): one per filmed visit, newest first. */
export const xrayFacts = async (db: Db, hospitalId: string, patientId: string) => (await filmsOf(db, hospitalId, eq(encounters.patientId, patientId))).map(f => f.line);

/**
 * Puts a visit's film in the library by its reading (document "xray:<visit>", kind "xray"), so a clinician's question
 * ("what did her X-ray show", "patients with a nodule", in English, Malay or Manglish) finds it and the answer hands
 * back the film (evidence.ts referenceOf). Indexed again after every upload, read and detection; never a Sona Care
 * source (packages/retrieval's search). Failing to index never fails the route that asked: the record still holds it.
 */
export async function indexXray(context: Context & { hospitalId: string }, encounterId: string) {
  const { hospitalId, library } = context;
  if (!library) return;
  try {
    const [film] = await filmsOf(context.db, hospitalId, eq(encounters.id, encounterId));
    if (!film) return;
    const text = `# Reading\nPatient: ${film.name} (${film.patientId}). Chest X-ray taken ${day(film.at)}.\n${film.line}\n\n# Search terms\n${["chest X-ray / X-ray dada / 胸部X光", ...film.kinds.map(k => TERMS[k])].join("\n")}`;
    await library.ingest({ id: `xray:${encounterId}`, kind: "xray", hospitalId, title: `Chest X-ray: ${film.name}, ${day(film.at)}`, source: "Imaging", year: film.at.getFullYear(), ownerId: null, uploadedBy: null }, text);
  } catch (error) {
    console.error(`X-ray ${encounterId} not indexed`, error);
  }
}

const similarSchema = z.object({ encounterId: z.string().min(1).optional(), text: z.string().min(1).optional(), k: z.number().int().min(1).max(10).default(5) })
  .refine(i => !!i.encounterId !== !!i.text, "Give an encounterId or a text, not both");

/** X-rays go to storage under the hospital's own prefix; the encounter remembers the latest one. */
export const xrayRouter = {
  upload: protectedProcedure.input(xrayUploadSchema).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    const [visit] = await db.select({ patientId: encounters.patientId }).from(encounters).where(and(eq(encounters.id, input.encounterId), eq(encounters.hospitalId, hospitalId)));
    if (!visit) throw new ORPCError("NOT_FOUND", { message: `No encounter ${input.encounterId}` });
    const key = `${hospitalId}/xray/${input.encounterId}/${crypto.randomUUID()}`;
    const bytes = Uint8Array.from(atob(input.dataBase64), c => c.charCodeAt(0));
    await bucket(context).put(key, bytes, { httpMetadata: { contentType: input.contentType } });
    const now = clockOf(context), latest = { key, contentType: input.contentType, uploadedAt: now.toISOString() };
    await db.update(encounters).set({ state: sql`jsonb_set(${encounters.state}, '{xray}', ${JSON.stringify(latest)}::jsonb)` }).where(eq(encounters.id, input.encounterId));
    await indexXray(context, input.encounterId);
    // The film's vector, for xray.similar: the visit's latest film only, as the visit itself remembers only that one. A
    // failed embedding never fails the upload; the film is just not indexed (and xray.similar says so).
    const embedding = await context.imageEmbedder?.images([bytes]).then(v => v[0], error => { console.error("film not indexed", error); return undefined; });
    if (embedding) {
      await db.delete(imageVectors).where(eq(imageVectors.encounterId, input.encounterId));
      await db.insert(imageVectors).values({ key, hospitalId, encounterId: input.encounterId, patientId: visit.patientId, embedding, createdAt: now });
    }
    return { key };
  }),
  /** The latest image's key and what the model seam says about it; never a validated read. A model reads each image once. */
  read: protectedProcedure.input(z.object({ encounterId: z.string().min(1) })).handler(async ({ context, input }) => {
    const { state } = await loadEncounter(context.db, context.hospitalId, input.encounterId);
    const latest = (state as { xray?: Film }).xray;
    const missing = () => new ORPCError("NOT_FOUND", { message: `No X-ray uploaded for ${input.encounterId}` });
    if (!latest) throw missing();
    const read = await answerOnce(context.db, input.encounterId, "xray-read", { image: latest.key }, async () => {
      const object = await bucket(context).get(latest.key);
      if (!object) throw missing();
      return (context.models ?? stubModels).xrayRead({ image: new Uint8Array(await object.arrayBuffer()), contentType: latest.contentType });
    }, () => [latest.key]);
    await indexXray(context, input.encounterId);
    return { key: latest.key, ...read, validated: false as const };
  }),
  /** The visit's latest film itself, for the app to show beside an answer that cites it (an "image" reference). */
  image: protectedProcedure.input(z.object({ encounterId: z.string().min(1) })).handler(async ({ context, input }) => {
    const { state } = await loadEncounter(context.db, context.hospitalId, input.encounterId);
    const latest = (state as { xray?: Film }).xray;
    const object = latest && await bucket(context).get(latest.key);
    if (!latest || !object) throw new ORPCError("NOT_FOUND", { message: `No X-ray uploaded for ${input.encounterId}` });
    return { key: latest.key, contentType: latest.contentType, dataBase64: base64Of(new Uint8Array(await object.arrayBuffer())), uploadedAt: latest.uploadedAt };
  }),
  /**
   * The hospital's films nearest a visit's latest film ("films like this one") or a phrase ("effusion on the left"), by
   * cosine in BiomedCLIP's space, never the visit's own; each with the findings read on it (none when unread). `indexed`
   * false: the visit's film has no vector (uploaded while the embedder was down), so there is nothing to compare.
   */
  similar: protectedProcedure.input(similarSchema).handler(async ({ context, input }) => {
    const { db, hospitalId, imageEmbedder } = context;
    if (!imageEmbedder) throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Film search is not configured" });
    let query: number[];
    if (input.encounterId) {
      const { state } = await loadEncounter(db, hospitalId, input.encounterId);
      const key = (state as { xray?: { key: string } }).xray?.key;
      const [own] = key ? await db.select({ embedding: imageVectors.embedding }).from(imageVectors).where(eq(imageVectors.key, key)) : [];
      if (!own) return { films: [], indexed: false };
      query = own.embedding;
    } else query = (await imageEmbedder.text([input.text!]))[0]!;
    const distance = cosineDistance(imageVectors.embedding, query);
    const films = await db.select({ encounterId: imageVectors.encounterId, patientId: imageVectors.patientId, patientName: patients.name, uploadedAt: imageVectors.createdAt, score: sql<number>`1 - (${distance})` })
      .from(imageVectors).innerJoin(patients, eq(patients.id, imageVectors.patientId))
      .where(and(eq(imageVectors.hospitalId, hospitalId), input.encounterId ? ne(imageVectors.encounterId, input.encounterId) : undefined))
      .orderBy(asc(distance)).limit(input.k);
    const read = films.length ? await db.select({ encounterId: findings.encounterId, label: findings.label }).from(findings)
      .where(and(inArray(findings.encounterId, films.map(f => f.encounterId)), ne(findings.status, "dismissed"))).orderBy(asc(findings.createdAt), asc(findings.id)) : [];
    return { films: films.map(f => ({ ...f, score: Number(f.score), findings: read.filter(r => r.encounterId === f.encounterId).map(r => r.label) })), indexed: true };
  }),
};
