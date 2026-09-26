import type { Context as ApiContext } from "@sona-ai/api/context";
import type { Context as HonoContext } from "hono";

import type { EncounterStore } from "@sona-ai/api/context";

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
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

/** Edits and reviews go through the encounter's own Durable Object, which writes Postgres for us. */
function encounterStore(env: Env): EncounterStore {
  const of = (encounterId: string) => env.ENCOUNTERS.get(env.ENCOUNTERS.idFromName(encounterId));
  return {
    edit: (hospitalId, edit) => of(edit.encounterId).edit(hospitalId, edit),
    recordReview: (hospitalId, review) => of(review.encounterId).recordReview(hospitalId, review),
  };
}
