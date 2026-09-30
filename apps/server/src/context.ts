import type { Context as ApiContext } from "@sona-ai/api/context";
import type { Change } from "@sona-ai/api/events";
import { patientsFor } from "@sona-ai/api/audience";
import type { Context as HonoContext } from "hono";

import { basetenModels, basetenReranker } from "@sona-ai/api/baseten-models";
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
  // The hosted models once a Baseten key is set; without one every model answer stays a labelled fixture.
  const baseten = ENV.BASETEN_API_KEY ? { apiKey: ENV.BASETEN_API_KEY } : undefined;
  const reranker = baseten && basetenReranker(baseten);
  return {
    db,
    session,
    encounters: encounterStore(context.env as Env),
    // X-ray uploads land in the Worker's R2 bucket.
    uploads: (context.env as Env).UPLOADS,
    models: baseten && basetenModels(baseten),
    baseten,
    publicUrl: ENV.BETTER_AUTH_URL,
    mail: mailOf(context.env as Env),
    announce: announcer(context.env as Env),
    // ponytail: hashed bag-of-words vectors until EmbeddingGemma runs in box ②; swap stubEmbedder for it then (and re-ingest).
    library: { ingest: (doc, text) => ingest(db, doc, text, stubEmbedder), search: input => search(db, input, stubEmbedder, reranker) },
    // Staging only: Sona Care's sign-in shows the seeded demo phone and its fixed code.
    demoSignIn: ENV.DEMO_SIGN_IN === "1",
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

/** The channel a Sona Care patient's app listens on (one per patient, so a change never reaches another patient). */
export const patientChannel = (patientId: string) => `patient:${patientId}`;

/**
 * Changes go to the hospital's channel (its clinicians), and to the Sona Care app of each patient the
 * change is about: the one named in it, the patient of its visit, or, for the demo clock, every
 * patient linked at that hospital. A patient's channel only ever hears changes about them.
 */
export function announcer(env: Env): ApiContext["announce"] {
  const send = (name: string, change: Change) => env.CHANNELS.get(env.CHANNELS.idFromName(name)).announce(change);
  return async (hospitalId, change) => {
    await send(hospitalId, change);
    const patients = await patientsFor(await getDb(), hospitalId, change).catch(() => []);
    await Promise.all(patients.map(id => send(patientChannel(id), { topic: change.topic })));
  };
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
