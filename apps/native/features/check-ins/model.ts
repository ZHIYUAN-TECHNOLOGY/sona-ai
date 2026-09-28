import { checkInMessage, checkInSchedule, readReply, replyFlag, type CheckIn, type Reply } from "@sona-ai/domain/check-ins";
import type { DayItem } from "@/features/day/model";
import type { DischargeState } from "@/features/discharge/model";
import type { Patient } from "@/features/encounter/types";

export * from "@sona-ai/domain/check-ins";

/**
 * Where "Call back" dials. The synthetic records hold no patient phone numbers, so it rings the
 * ward's line (a placeholder number, not a working one) for the clinician to put the call through.
 * ponytail: dial the patient's own number once the record carries one.
 */
export const WARD_PHONE = { display: "+60 3-0000 0000", tel: "+60300000000" };
/** What the patient's Sona Care thread shows after a call-back is logged. */
export const callBackNote = (clinician?: string | null) => `Called back by ${clinician?.trim() || "your care team"}.`;

const first = (name: string) => name.split(" ")[0]!;
const clock = (at: Date) => `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
/** "Mon 28 Sep", as the day picker writes dates. */
export const shortDate = (at: Date) => at.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");

/**
 * Fixture mode: a discharged patient's check-ins, derived from the encounter's discharge and the
 * replies made on this device (the same IDs and rules as the server). Replies older than the
 * discharge belong to an earlier demo run, so a reset and a new discharge start clean.
 */
export function fixtureCheckIns(patient: Patient, discharge: DischargeState | undefined, replies: Record<string, Reply[]>, now: Date): CheckIn[] {
  if (!discharge?.dischargedAt) return [];
  const at = new Date(discharge.dischargedAt);
  return checkInSchedule(at).map(({ day, dueAt }) => {
    const id = `check-in:${patient.encounterId}:${day}`;
    const mine = (replies[id] ?? []).filter(r => r.receivedAt >= at);
    return {
      id, patientId: patient.id, encounterId: patient.encounterId, day, language: discharge.language, message: checkInMessage(first(patient.name), discharge.language),
      dueAt, sentAt: dueAt <= now ? dueAt : mine[0]?.receivedAt ?? null, replies: mine,
    };
  });
}

/** A reply read on the device by the keyword rule the server's stub uses; worse or urgent carries its task, keyed like the server's. */
export function fixtureReply(patientName: string, text: string, at: Date): Reply {
  const id = `reply-${at.getTime()}`, label = readReply(text), flag = replyFlag(first(patientName), label, text);
  return { id, text, label, source: "fixture", receivedAt: at, task: flag ? { id, title: flag.title, completed: false } : null };
}

/** The receipt's line: "Day 2 Mon 28 Sep · Day 7 Sat 3 Oct". */
export const scheduleLine = (dischargedAt: Date) => checkInSchedule(dischargedAt).map(c => `Day ${c.day} ${shortDate(c.dueAt)}`).join(" · ");

/** Tasks already shown as a flagged check-in row, so My Day does not list them twice. */
export const flaggedTaskIds = (checkIns: CheckIn[]) => checkIns.flatMap(c => c.replies.flatMap(r => (r.task ? [r.task.id] : [])));

/**
 * My Day's red rows: every worse or urgent reply whose task is still open, plus any in `keep` (just
 * booked in, still offering its same-visit follow-ups); the row's ID carries the task's.
 */
export function flaggedItems(checkIns: CheckIn[], keep: string[] = []): DayItem[] {
  return checkIns.flatMap(c => c.replies.flatMap(r => {
    const flag = r.task && (!r.task.completed || keep.includes(r.task.id)) ? replyFlag(r.task.title.split(":")[0]!, r.label, r.text) : undefined;
    return flag ? [{
      id: `check-in-${r.task!.id}`, kind: "check-in" as const, title: r.task!.title, detail: `“${r.text}” · day ${c.day} check-in`,
      reason: `${r.label === "urgent" ? "Urgent" : "Worse"} after discharge · replied ${clock(new Date(r.receivedAt))}`, tone: "urgent" as const, score: flag.score, patientId: c.patientId, open: {},
    }] : [];
  }));
}
