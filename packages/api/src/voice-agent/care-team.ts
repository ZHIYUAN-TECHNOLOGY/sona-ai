import { clockOf, type Context } from "../context";
import { listCheckIns, replyToCheckIn } from "../routers/check-ins";

/**
 * A patient who tells Sona Care's live voice they feel worse is heard the way a check-in reply is: their words become a
 * reply to their latest sent check-in (or the next one, sent now, as the demo does), read by the same reader, and a
 * worse or urgent reading flags one task for the attending doctor. The hospital's channel then hears "checkIns", so Sona
 * Pro's My Day flags the patient at once. Returns the flagged task, if one was made (none while they have no check-ins).
 * ponytail: a voice report sits in the check-in thread; a separate "said to Sona" source waits for a real need.
 */
export async function tellCareTeam(context: Context, hospitalId: string, patientId: string, text: string) {
  const now = clockOf(context);
  const checkIns = await listCheckIns(context.db, hospitalId, { patientId });
  const checkIn = checkIns.findLast(c => c.sentAt && c.sentAt <= now) ?? checkIns.find(c => !c.sentAt);
  if (!checkIn) return undefined;
  const said = text.trim().slice(0, 1000);
  const replied = await replyToCheckIn(context, hospitalId, { checkInId: checkIn.id, text: said }, patientId);
  await context.announce?.(hospitalId, { topic: "checkIns", patientId }).catch(() => {});
  const task = replied.replies.findLast(r => r.text === said)?.task;
  return task && !task.completed ? { taskId: task.id, title: task.title } : undefined;
}
