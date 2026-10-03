import { ORPCError } from "@orpc/server";
import { encounters } from "@sona-ai/db/schema/clinical";
import { eq, sql } from "drizzle-orm";
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

/** X-rays go to storage under the hospital's own prefix; the encounter remembers the latest one. */
export const xrayRouter = {
  upload: protectedProcedure.input(xrayUploadSchema).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    await loadEncounter(db, hospitalId, input.encounterId);
    const key = `${hospitalId}/xray/${input.encounterId}/${crypto.randomUUID()}`;
    const bytes = Uint8Array.from(atob(input.dataBase64), c => c.charCodeAt(0));
    await bucket(context).put(key, bytes, { httpMetadata: { contentType: input.contentType } });
    const latest = { key, contentType: input.contentType, uploadedAt: clockOf(context).toISOString() };
    await db.update(encounters).set({ state: sql`jsonb_set(${encounters.state}, '{xray}', ${JSON.stringify(latest)}::jsonb)` }).where(eq(encounters.id, input.encounterId));
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
};
