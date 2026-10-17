import { careLinks, encounters } from "@sona-ai/db/schema/clinical";
import { and, eq } from "drizzle-orm";

import type { Context } from "./context";
import type { Change } from "./events";

/**
 * Which Sona Care patients a change is about, so the Worker can tell their apps too: the patient it
 * names, the patient of its visit, or, for the demo clock, every patient linked at that hospital.
 */
export async function patientsFor(db: Context["db"], hospitalId: string, change: Change): Promise<string[]> {
  if (change.patientId) return [change.patientId];
  if (change.topic === "demo") return (await db.select({ id: careLinks.patientId }).from(careLinks).where(eq(careLinks.hospitalId, hospitalId))).map(r => r.id);
  if (!change.encounterId) return [];
  const [row] = await db.select({ id: encounters.patientId }).from(encounters).where(and(eq(encounters.id, change.encounterId), eq(encounters.hospitalId, hospitalId)));
  return row ? [row.id] : [];
}
