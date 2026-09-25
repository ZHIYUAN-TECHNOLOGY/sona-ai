import type { Session } from "@sona-ai/auth";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core/async";

export type Context = {
  session: Session | null;
  /** Any drizzle Postgres database: Neon in the Worker, PGlite in tests. */
  db: PgAsyncDatabase<any, any>;
};
