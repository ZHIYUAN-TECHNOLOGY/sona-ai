import { or, sql } from "drizzle-orm";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core/async";

import { drugs } from "./schema";

type AnyDb = PgAsyncDatabase<any, any>;
export type IcdHit = { code: string; label: string };

/** WHO ICD-10 lookup: an exact code wins; otherwise labels ranked by full-text and trigram match. */
export async function searchIcd(db: AnyDb, query: string, k = 10): Promise<IcdHit[]> {
  const q = query.trim();
  const exact = await db.execute<IcdHit>(sql`select code, label from icd10_codes where code = ${q.toUpperCase()}`);
  if (exact.rows.length) return exact.rows;
  // A subcategory reads in the context of its category ("J18.9 Pneumonia, unspecified" sits under
  // "Pneumonia, organism unspecified"), and only codes without subdivisions are offered.
  // ponytail: computed text scans the table (fine for a few thousand rows); a generated search column if the full WHO list is loaded.
  const ranked = await db.execute<IcdHit>(sql`
    with t as (
      select c.code, c.label, coalesce(p.label || ' ', '') || c.label as text
      from icd10_codes c left join icd10_codes p on p.code = split_part(c.code, '.', 1) and p.code <> c.code
      where not exists (select 1 from icd10_codes s where s.code like c.code || '.%')
    )
    select code, label from t, plainto_tsquery('english', ${q}) tq
    where to_tsvector('english', text) @@ tq or word_similarity(${q}, text) >= 0.4
    order by (to_tsvector('english', text) @@ tq) desc, similarity(${q}, text) desc, code
    limit ${k}`);
  return ranked.rows;
}

/** Same shape as drugLookupSchema in @sona-ai/api (which depends on this package, so it can't be imported here). */
export type DrugLookup = { status: "covered"; drug: string; dose: string; sourceId: string } | { status: "not-covered"; drug: string };

/** A dose only from the bounded drug table, matched by name or ingredient; anything else is "not covered", never guessed. */
export async function drugLookup(db: AnyDb, name: string): Promise<DrugLookup> {
  const q = name.trim();
  const [row] = await db.select().from(drugs)
    .where(or(sql`lower(${drugs.name}) = lower(${q})`, sql`lower(${drugs.ingredient}) = lower(${q})`))
    .orderBy(sql`lower(${drugs.name}) = lower(${q}) desc`).limit(1);
  return row ? { status: "covered", drug: row.name, dose: row.dose, sourceId: row.sourceId } : { status: "not-covered", drug: q };
}
