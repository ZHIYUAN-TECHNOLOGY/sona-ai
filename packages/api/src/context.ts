import type { Session } from "@sona-ai/auth";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core/async";

import type { EncounterEdit, RecordReview } from "./contracts";
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
};

export const clockOf = (context: Pick<Context, "now">) => context.now?.() ?? new Date();
