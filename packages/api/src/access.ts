import { accessLogs, encounters } from "@sona-ai/db/schema/clinical";
import { and, eq } from "drizzle-orm";

import { clockOf, type Context } from "./context";

/**
 * PDPA access trail: the clinician middleware calls this after every successful call whose input
 * names a patient or a visit (reads and writes alike); Sona Care's own routes never do. A visit alone
 * is resolved to its patient within the caller's hospital. Read back by accessLog.list.
 */
export async function recordAccess(context: Pick<Context, "db" | "now">, hospitalId: string, userId: string, route: string, input: unknown) {
  const { patientId, encounterId } = (input ?? {}) as { patientId?: unknown; encounterId?: unknown };
  const visit = typeof encounterId === "string" ? encounterId : null;
  let patient = typeof patientId === "string" ? patientId : null;
  if (!patient && !visit) return;
  if (!patient && visit) {
    const [row] = await context.db.select({ patientId: encounters.patientId }).from(encounters).where(and(eq(encounters.id, visit), eq(encounters.hospitalId, hospitalId)));
    patient = row?.patientId ?? null;
  }
  await context.db.insert(accessLogs).values({ id: crypto.randomUUID(), hospitalId, userId, patientId: patient, encounterId: visit, route, at: clockOf(context) });
}
