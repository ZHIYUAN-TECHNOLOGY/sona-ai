import { appointments, careLinks, checkInReplies, checkIns, doseLogs, encounters, findings, tasks } from "@sona-ai/db/schema/clinical";
import { adherence } from "@sona-ai/domain/doses";
import type { DischargeState } from "@sona-ai/domain/discharge";
import { and, eq, gte, inArray } from "drizzle-orm";

import { clockOf } from "../context";
import { protectedProcedure } from "../index";
import { doseScheduleOf } from "./care-plan";

/**
 * The ops counter: this week's numbers for ward and hospital management, each counted from the rows
 * the loops write, never typed in. Bed time saved (discharge receipts), red flags from check-ins and
 * how many were acted on, the median time from a flagged reply to Book in, check-ins answered,
 * X-ray follow-ups lost (open past due; the goal is 0) and dose adherence across Sona Care patients.
 * Read on the demo clock, so a jump to day 2 counts day 2's week.
 */
const WEEK = 7 * 86_400_000;

export const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export const opsRouter = {
  get: protectedProcedure.handler(async ({ context }) => {
    const { db, hospitalId } = context;
    const now = clockOf(context), since = new Date(now.getTime() - WEEK);

    const visits = await db.select({ state: encounters.state }).from(encounters).where(eq(encounters.hospitalId, hospitalId));
    const discharged = visits.map(v => (v.state as { discharge?: DischargeState }).discharge)
      .filter((d): d is DischargeState & { dischargedAt: string } => {
        const at = d?.dischargedAt ? new Date(d.dischargedAt) : undefined;
        return Boolean(at && at >= since && at <= now);
      });
    const bedMinutesSaved = discharged.reduce((sum, d) => sum + (d.savedMinutes ?? 0), 0);

    const sent = await db.select({ id: checkIns.id }).from(checkIns)
      .where(and(eq(checkIns.hospitalId, hospitalId), gte(checkIns.sentAt, since)));
    const replies = sent.length ? await db.select({ checkInId: checkInReplies.checkInId, taskId: checkInReplies.taskId, receivedAt: checkInReplies.receivedAt })
      .from(checkInReplies).where(inArray(checkInReplies.checkInId, sent.map(c => c.id))) : [];
    const answered = new Set(replies.map(r => r.checkInId)).size;

    const flags = replies.filter(r => r.taskId);
    const flagTasks = flags.length ? await db.select({ id: tasks.id, completed: tasks.completed }).from(tasks).where(inArray(tasks.id, flags.map(f => f.taskId!))) : [];
    const booked = flags.length ? await db.select({ id: appointments.id, bookedAt: appointments.bookedAt }).from(appointments)
      .where(inArray(appointments.id, flags.map(f => `book-in:${f.taskId}`))) : [];
    const minutesToBook = flags.flatMap(f => {
      const b = booked.find(x => x.id === `book-in:${f.taskId}`)?.bookedAt;
      return b ? [(b.getTime() - f.receivedAt.getTime()) / 60_000] : [];
    });

    const allFindings = await db.select({ status: findings.status, dueAt: findings.dueAt }).from(findings).where(eq(findings.hospitalId, hospitalId));
    const lostFollowUps = allFindings.filter(f => f.status === "open" && f.dueAt && f.dueAt < now).length;
    const trackedFollowUps = allFindings.filter(f => f.status === "tracked").length;

    const linked = await db.select({ patientId: careLinks.patientId }).from(careLinks).where(eq(careLinks.hospitalId, hospitalId));
    let due = 0, taken = 0;
    for (const { patientId } of linked) {
      const schedule = await doseScheduleOf(db, hospitalId, patientId);
      if (!schedule) continue;
      const keys = (await db.select({ key: doseLogs.key }).from(doseLogs).where(and(eq(doseLogs.hospitalId, hospitalId), eq(doseLogs.patientId, patientId)))).map(r => r.key);
      const a = adherence(schedule.meds, schedule.dischargedAt, keys, now);
      due += a.due; taken += a.taken;
    }

    return {
      since, now,
      bedMinutesSaved, discharges: discharged.length,
      redFlags: flags.length, redFlagsActedOn: flagTasks.filter(t => t.completed).length,
      medianMinutesToBook: median(minutesToBook) ?? null,
      checkInsSent: sent.length, checkInsAnswered: answered,
      lostFollowUps, trackedFollowUps,
      dosesDue: due, dosesTaken: taken,
    };
  }),
};
