import { auditItems, casemixWeights, claims, encounters, labResults, notes } from "@sona-ai/db/schema/clinical";
import { codingGaps, type Casemix } from "@sona-ai/domain/audit";
import { and, desc, eq } from "drizzle-orm";

import type { Context } from "./context";

/**
 * The nightly coding audit (Cloudflare cron): for each encounter, compare its latest note and the
 * patient's labs with the codes on its claim, and record each lab-only diagnosis as an open audit
 * item priced from the casemix weight. Item IDs are deterministic, so a rerun changes nothing.
 * ponytail: lab rules only; wording gaps ("organism not stated") arrive with the coding model.
 */
export async function runNightlyAudit(db: Context["db"], hospitalId: string, at: Date) {
  const casemix: Casemix = Object.fromEntries((await db.select().from(casemixWeights)).map(w => [w.code, { weight: w.weight, baseRateCents: w.baseRateCents }]));
  const visits = await db.select().from(encounters).where(eq(encounters.hospitalId, hospitalId));
  let raised = 0;
  for (const visit of visits) {
    const [note] = await db.select().from(notes).where(eq(notes.encounterId, visit.id)).orderBy(desc(notes.revision)).limit(1);
    if (!note) continue;
    const labs = await db.select().from(labResults).where(eq(labResults.patientId, visit.patientId));
    const [claim] = await db.select({ codes: claims.codes }).from(claims).where(eq(claims.encounterId, visit.id));
    const gaps = codingGaps({ sentences: note.sentences, labs: labs.map(l => ({ test: l.test, value: l.value, unit: l.unit ?? "", sourceId: l.sourceId })), codes: claim?.codes.map(c => c.code) ?? [] }, casemix);
    for (const g of gaps) {
      await db.insert(auditItems).values({
        id: `audit:${visit.id}:${g.toCode}`, hospitalId, encounterId: visit.id, patientId: visit.patientId,
        // ponytail: the note's author is not stored yet; the attending doctor comes with note authorship.
        doctor: "Attending doctor", gap: g.gap, fromCode: g.fromCode, toCode: g.toCode, riskCents: g.riskCents, query: g.query, createdAt: at,
      }).onConflictDoNothing();
      raised++;
    }
  }
  return { raised };
}

export async function openAuditItems(db: Context["db"], hospitalId: string) {
  return db.select().from(auditItems).where(and(eq(auditItems.hospitalId, hospitalId), eq(auditItems.status, "open"))).orderBy(desc(auditItems.riskCents));
}
