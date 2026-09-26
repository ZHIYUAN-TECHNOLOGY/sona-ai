import type { Context as ApiContext } from "@sona-ai/api/context";
import type { Context as HonoContext } from "hono";

import type { EncounterStore } from "@sona-ai/api/context";
import { ingest, search, stubEmbedder } from "@sona-ai/retrieval/retrieval";

import { ENV } from "./env.server";
import { getDb } from "./services";
import { createAuth } from "./services";

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions): Promise<ApiContext> {
  const db = await getDb();
  const session = await (
    await createAuth(db)
  ).api.getSession({
    headers: context.req.raw.headers,
  });
  return {
    db,
    session,
    encounters: encounterStore(context.env as Env),
    // X-ray uploads land in the Worker's R2 bucket; models stay on stubModels until Baseten is on.
    uploads: (context.env as Env).UPLOADS,
    publicUrl: ENV.BETTER_AUTH_URL,
    mail: mailOf(context.env as Env),
    announce: announcer(context.env as Env),
    // ponytail: hashed bag-of-words vectors until EmbeddingGemma runs in box ②; swap stubEmbedder for it then (and re-ingest).
    library: { ingest: (doc, text) => ingest(db, doc, text, stubEmbedder), search: input => search(db, input, stubEmbedder) },
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

/** Changes go to the hospital's channel, which pushes them to its connected apps. */
export function announcer(env: Env): ApiContext["announce"] {
  return (hospitalId, change) => env.CHANNELS.get(env.CHANNELS.idFromName(hospitalId)).announce(change);
}

/** Email only once a sender and the insurer's inbox are configured (see packages/infra/alchemy.run.ts). */
function mailOf(env: Env): ApiContext["mail"] {
  if (!env.EMAIL || !env.EMAIL_FROM || !env.INSURER_EMAIL) return undefined;
  return { from: env.EMAIL_FROM, insurer: env.INSURER_EMAIL, send: message => env.EMAIL.send(message) };
}

/** Edits and reviews go through the encounter's own Durable Object, which writes Postgres for us. */
function encounterStore(env: Env): EncounterStore {
  const of = (encounterId: string) => env.ENCOUNTERS.get(env.ENCOUNTERS.idFromName(encounterId));
  return {
    edit: (hospitalId, edit) => of(edit.encounterId).edit(hospitalId, edit),
    recordReview: (hospitalId, review) => of(review.encounterId).recordReview(hospitalId, review),
  };
}
