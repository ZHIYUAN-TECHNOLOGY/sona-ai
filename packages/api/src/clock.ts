import { hospitals } from "@sona-ai/db/schema/clinical";
import { eq } from "drizzle-orm";

import type { Context } from "./context";

/**
 * The demo clock: a hospital's time runs at real time plus `clock_offset_ms`, so a demo can jump to
 * the day-2 check-in, day 7 or the clinic review without waiting days. Every route reads time through
 * clockOf, which the procedure middleware sets from this offset; Sona Care reads the offset too, so
 * both apps agree on "now". Only the synthetic demo hospital may move its clock (routers/demo).
 */
export async function clockOffsetOf(db: Context["db"], hospitalId: string) {
  const [row] = await db.select({ offset: hospitals.clockOffsetMs }).from(hospitals).where(eq(hospitals.id, hospitalId));
  return row?.offset ?? 0;
}

/** The context's clock moved by a hospital's offset (a test's fixed clock stays the base). */
export function shifted(base: Context["now"], offset: number): Context["now"] {
  if (!offset) return base;
  return () => new Date((base?.() ?? new Date()).getTime() + offset);
}
