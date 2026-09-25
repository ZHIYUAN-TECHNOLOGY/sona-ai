import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";

import { relations } from "./relations";

/** A throwaway in-process Postgres with every migration applied, for tests (no cloud keys needed). */
export async function createTestDb() {
  const client = new PGlite({ extensions: { vector, pg_trgm } });
  const db = drizzle({ client, relations });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("./migrations", import.meta.url).href) });
  return db;
}
export type TestDb = Awaited<ReturnType<typeof createTestDb>>;
