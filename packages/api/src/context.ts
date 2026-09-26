import type { Session } from "@sona-ai/auth";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core/async";

import type { EncounterEdit, RecordReview } from "./contracts";
import type { Models } from "./models";
import type { EncounterSnapshot } from "./routers/encounter";

export type EncounterStore = {
  edit(hospitalId: string, edit: EncounterEdit): Promise<EncounterSnapshot>;
  recordReview(hospitalId: string, review: RecordReview): Promise<EncounterSnapshot>;
};

export type Context = {
  session: Session | null;
  /** Any drizzle Postgres database: Neon in the Worker, PGlite in tests. */
  db: PgAsyncDatabase<any, any>;
  /** The Worker passes the encounter's Durable Object so edits go through the live state; tests write Postgres directly. */
  encounters?: EncounterStore;
  /** The clock; tests pass a fixed one so time-based rules (the mock insurer) are deterministic. */
  now?: () => Date;
  /** The model seam; stubModels (fixtures) until the Baseten boxes come off hold. */
  models?: Models;
  /** Image storage: the Worker passes its R2 bucket; tests pass an in-memory one. */
  uploads?: Uploads;
  /** Outbound HTTP (PubMed); tests pass a fake so nothing leaves the machine. */
  fetch?: typeof fetch;
  /** The Worker's public address, for links that open outside the app (the insurer's review page). */
  publicUrl?: string;
  /** Outbound email (Cloudflare Email Service); absent until a sending domain and the inboxes are configured. */
  mail?: Mail;
};

/** Email as the routes use it: who sends, the insurer's inbox, and the send itself. */
export type Mail = {
  from: string;
  insurer: string;
  send(message: { from: string; to: string; subject: string; text: string; html?: string }): Promise<unknown>;
};

/** The slice of an R2 bucket the routes use. */
export type Uploads = {
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null>;
};

export const clockOf = (context: Pick<Context, "now">) => context.now?.() ?? new Date();
