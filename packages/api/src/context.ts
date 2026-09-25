import type { Session } from "@sona-ai/auth";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core/async";

export type Context = {
  session: Session | null;
  /** Any drizzle Postgres database: Neon in the Worker, PGlite in tests. */
  db: PgAsyncDatabase<any, any>;
  /** The clock; tests pass a fixed one so time-based rules (the mock insurer) are deterministic. */
  now?: () => Date;
};

export const clockOf = (context: Pick<Context, "now">) => context.now?.() ?? new Date();
