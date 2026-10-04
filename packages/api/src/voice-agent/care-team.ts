import { encounters, patients, tasks } from "@sona-ai/db/schema/clinical";
import { reasonOf, replyFlag } from "@sona-ai/domain/check-ins";
import { and, desc, eq } from "drizzle-orm";

import type { Context } from "../context";
import { stubModels } from "../models";
import { lastDischarge } from "../routers/care-plan";

/**
 * A patient who tells Sona Care they feel worse (in the live call, or a question typed or spoken to Ask Sona Care) is
 * read by the check-in replies' reader, and a worse or urgent reading flags one task for the attending doctor on their
 * visit, in hospital or at home. It is a report, not an answer to a check-in: no scheduled check-in is sent or replied
 * to by it. The hospital's channel then hears "checkIns", so Sona Pro's My Day re-reads at once. Returns the flagged
 * task and who read the words that flagged it, or none when the words read as fine.
 * ponytail: the task's title carries the symptom, not the patient's words (tasks have nowhere to keep them), and with
 * no reply behind it My Day lists it as a task, not as a red flagged reply; a "said to Sona" table when either matters.
 */
export async function tellCareTeam(context: Context, hospitalId: string, patientId: string, text: string) {
  const { db } = context, said = text.trim().slice(0, 1000);
  const [patient] = await db.select({ name: patients.name, encounterId: encounters.id }).from(patients)
    .leftJoin(encounters, eq(encounters.patientId, patients.id)).where(and(eq(patients.id, patientId), eq(patients.hospitalId, hospitalId))).orderBy(desc(encounters.updatedAt)).limit(1);
  if (!patient) return undefined;
  const discharged = await lastDischarge(db, hospitalId, patientId);
  const read = await (context.models ?? stubModels).classifyReply({ text: said, language: discharged?.language ?? "en" });
  const first = patient.name.split(" ")[0]!, flag = replyFlag(first, read.label, said, read.symptom);
  if (!flag) return undefined;
  // "after discharge" only once they have left.
  const title = discharged ? flag.title : `${first}: ${reasonOf(flag.title)}`, encounterId = discharged?.encounterId ?? patient.encounterId;
  // The same problem again, while its task is still open, rides on that task (as a check-in reply does).
  const [open] = encounterId ? await db.select({ id: tasks.id }).from(tasks)
    .where(and(eq(tasks.hospitalId, hospitalId), eq(tasks.encounterId, encounterId), eq(tasks.kind, "check-in"), eq(tasks.title, title), eq(tasks.completed, false))) : [];
  const id = open?.id ?? crypto.randomUUID();
  if (!open) await db.insert(tasks).values({ id, hospitalId, encounterId, kind: "check-in", title, owner: "Attending doctor", due: "Today", sourceId: id, idempotencyKey: `check-in:${id}` });
  await context.announce?.(hospitalId, { topic: "checkIns", patientId }).catch(() => {});
  // `readBy`: who read the patient's words as worse or urgent, so the task is never shown as a model's call when the
  // keyword rule made it (the stub, a failed model, or the rule's urgent words over a milder model reading).
  const { label, symptom: _, decidedBy, ...origin } = read;
  return { taskId: id, title, label, readBy: { ...origin, decidedBy: origin.source === "model" ? decidedBy ?? "model" : "rules" as const } };
}
