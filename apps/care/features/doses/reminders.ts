import { doseKey, doseSlots, type ScheduledMed } from "@sona-ai/domain/doses";

/**
 * Dose reminders, the plain part (no React Native, so bun can test it): which local notifications the
 * phone should hold for the doses ahead. Rule-based from the discharge plan; nothing leaves the phone.
 *
 * The demo clock: dose times are hospital (demo) time, while the phone fires on its own clock, so a
 * reminder is set for `dose time − offset`; one whose real time has passed is skipped.
 *
 * Honest limit: these are local, rebuilt whenever the app runs. A plan changed by the care team while
 * the app stays closed is only picked up at the next open; waking the phone for that needs remote push,
 * which needs `eas init` (an EAS projectId), not done here.
 */
export const REMINDER_PREFIX = "dose:";
/** A week of doses ahead, at most 60 (iOS keeps only 64 pending local notifications per app). */
export const REMINDER_DAYS = 7, REMINDER_CAP = 60;
const DAY = 86_400_000;

export type Reminder = { id: string; at: Date; doseKey: string };

/**
 * The reminders to hold: every dose from `now` (phone time, plus `offsetMs` for the demo clock) up to
 * seven days on, not yet taken and not already past, earliest first, capped.
 */
export function doseReminders({ meds, dischargedAt, taken, now, offsetMs = 0 }: {
  meds: ScheduledMed[]; dischargedAt: string | Date | undefined; taken: string[]; now: Date; offsetMs?: number;
}): Reminder[] {
  if (!dischargedAt) return [];
  const done = new Set(taken), until = new Date(now.getTime() + offsetMs + REMINDER_DAYS * DAY);
  return meds.flatMap(med => doseSlots(med, new Date(dischargedAt), until).map(dueAt => {
    const key = doseKey(med.name, dueAt);
    return { id: `${REMINDER_PREFIX}${key}`, at: new Date(dueAt.getTime() - offsetMs), doseKey: key };
  }))
    .filter(r => !done.has(r.doseKey) && r.at.getTime() > now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, REMINDER_CAP);
}

/** What a reminder opens: the Medicine screen at that dose's hold to take. */
export const reminderUrl = (key: string) => `sona-care:///dose?key=${encodeURIComponent(key)}`;
