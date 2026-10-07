import type { Context as ApiContext } from "@sona-ai/api/context";
import type { Change } from "@sona-ai/api/events";
import { patientsFor } from "@sona-ai/api/audience";
import type { Context as HonoContext } from "hono";
import { getAgentByName } from "agents";

import { basetenModels, basetenReranker } from "@sona-ai/api/baseten-models";
import type { EncounterStore } from "@sona-ai/api/context";
import type { Watches } from "@sona-ai/api/watches";
import { workersEmbedder } from "@sona-ai/api/workers-models";
import { awsOf, endpointsOf, hosted, sagemakerEmbedder, sagemakerImageEmbedder } from "@sona-ai/api/sagemaker";
import { ingest, reindex, search, stubEmbedder, type Reranker } from "@sona-ai/retrieval/retrieval";

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
  const baseten = hosted(ENV);
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
    library: libraryOf(db, context.env as Env, baseten && basetenReranker(baseten)),
    imageEmbedder: imageEmbedderOf(context.env as Env),
    // Staging only: Sona Care's sign-in shows the seeded demo phone and its fixed code.
    demoSignIn: ENV.DEMO_SIGN_IN === "1",
    followUps: followUpAgents(context.env as Env),
    watches: watchAgents(context.env as Env),
    waitUntil: promise => context.executionCtx.waitUntil(promise),
  };
}

/**
 * The retrieval library over `db`, for the routes and for Sona Care's voice agents (which search the hospital's patient
 * leaflets, and those are never reranked). EmbeddingGemma on its box in Malaysia when SAGEMAKER_ENDPOINTS names it
 * (embed=sona-embed), else on Workers AI; the hashed stub only where the Worker has no AI binding. Switching to or from
 * the stub needs one `library.reindex`, since its vectors do not compare; the box and Workers AI run the same weights.
 */
export function libraryOf(db: ApiContext["db"], env: Env, reranker?: Reranker): NonNullable<ApiContext["library"]> {
  const aws = awsOf(env), box = endpointsOf(env.SAGEMAKER_ENDPOINTS ?? "").embed;
  const embedder = aws && box ? sagemakerEmbedder({ ...aws, endpoint: box }) : env.AI ? workersEmbedder(env.AI) : stubEmbedder;
  return {
    ingest: (doc, text) => ingest(db, doc, text, embedder),
    search: input => search(db, input, embedder, reranker),
    reindex: hospitalId => reindex(db, embedder, hospitalId),
  };
}

/** BiomedCLIP on the embedder's box, the same one as libraryOf's (embed=sona-embed); none without it, and xray.similar says so. */
export function imageEmbedderOf(env: Env): ApiContext["imageEmbedder"] {
  const aws = awsOf(env), box = endpointsOf(env.SAGEMAKER_ENDPOINTS ?? "").embed;
  return aws && box ? sagemakerImageEmbedder({ ...aws, endpoint: box }) : undefined;
}

/** Sona's follow-up: each discharged visit's own check-in agent (./agents/check-in.ts), named by the visit. */
export function followUpAgents(env: Env): NonNullable<ApiContext["followUps"]> {
  const of = (encounterId: string) => getAgentByName(env.CHECK_IN_AGENTS, encounterId);
  return {
    tick: async (hospitalId, encounterId) => (await of(encounterId)).tick(hospitalId, encounterId),
    get: async (hospitalId, encounterId) => (await of(encounterId)).view(hospitalId),
  };
}

/** Each clinician's own watch agent (./agents/watch.ts), named by the user. */
export function watchAgents(env: Env): Watches {
  const of = (userId: string) => getAgentByName(env.WATCH_AGENTS, userId);
  return {
    list: async (hospitalId, userId) => (await of(userId)).list(hospitalId, userId),
    add: async (hospitalId, userId, watch) => (await of(userId)).add(hospitalId, userId, watch),
    remove: async (hospitalId, userId, watchId) => (await of(userId)).remove(hospitalId, userId, watchId),
    tick: async (hospitalId, userId) => (await of(userId)).tick(hospitalId, userId),
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
