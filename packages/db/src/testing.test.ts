import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { createTestDb } from "./testing";

test("a test database has every table and the vector and trigram extensions", async () => {
  const db = await createTestDb();
  const tables = await db.execute(sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`);
  const ext = await db.execute(sql`select extname from pg_extension where extname in ('vector', 'pg_trgm') order by extname`);
  expect(tables.rows[0]).toEqual({ n: 39 });
  expect(ext.rows.map(r => r.extname)).toEqual(["pg_trgm", "vector"]);
});
