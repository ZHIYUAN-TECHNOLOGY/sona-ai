import { ORPCError } from "@orpc/server";
import { encounters, findings, imageVectors, patients } from "@sona-ai/db/schema/clinical";
import { and, asc, cosineDistance, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { answerOnce } from "../answers";
import { xrayUploadSchema } from "../contracts";
import { clockOf, type Context } from "../context";
import { stubModels } from "../models";
import { protectedProcedure } from "../index";
import { loadEncounter } from "./encounter";

export const bucket = (context: Pick<Context, "uploads">) => {
  if (!context.uploads) throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Image storage is not configured" });
  return context.uploads;
};

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
    const latest = (state as { xray?: { key: string; contentType: string } }).xray;
    const missing = () => new ORPCError("NOT_FOUND", { message: `No X-ray uploaded for ${input.encounterId}` });
    if (!latest) throw missing();
    const read = await answerOnce(context.db, input.encounterId, "xray-read", { image: latest.key }, async () => {
      const object = await bucket(context).get(latest.key);
      if (!object) throw missing();
      return (context.models ?? stubModels).xrayRead({ image: new Uint8Array(await object.arrayBuffer()), contentType: latest.contentType });
    }, () => [latest.key]);
    return { key: latest.key, ...read, validated: false as const };
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
