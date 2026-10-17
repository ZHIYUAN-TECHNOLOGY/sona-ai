import { malaysianDay } from "./care";

/**
 * A watch: a question a clinician asks Sona to keep asking, once a day at an hour they choose
 * ("every morning at 7, tell me which patients have potassium above 5"). Pure rules here: reading the
 * sentence and when a watch is due. The agent that runs them is apps/server/src/agents/watch.ts.
 */

/** A clinician keeps at most this many; each run asks the model once. */
export const MAX_WATCHES = 5;

const HOUR_OF = { day: 7, morning: 7, afternoon: 14, evening: 18, night: 21 } as const;
// ponytail: whole hours, once a day; minutes and weekdays are dropped until someone asks for them.
const SCHEDULE = /\b(?:(?:every|each)\s+(day|morning|afternoon|evening|night)|daily)(?:\s+at\s+(\d{1,2})(?::\d\d)?\s*(am|pm)?)?[,.]?\s*/i;
const LEAD_IN = /^(?:(?:hey\s+)?sona[,.]?\s+)?(?:please\s+)?(?:(?:tell|show|remind)\s+me|let\s+me\s+know|check)\s+/i;

/** A spoken or typed watch as its question and hour (0–23, the hospital's time); 07:00 when no time is said. */
export function parseWatch(text: string): { question: string; hour: number } {
  const said = SCHEDULE.exec(text);
  const part = (said?.[1]?.toLowerCase() ?? "morning") as keyof typeof HOUR_OF;
  let hour: number = HOUR_OF[part];
  const at = said?.[2] === undefined ? NaN : Number(said[2]);
  if (at >= 0 && at <= 23) {
    const half = said![3]?.toLowerCase();
    // "at 7" in the evening is 19:00; a stated am or pm wins.
    const late = half ? half === "pm" : part === "afternoon" || part === "evening" || part === "night";
    hour = at === 12 ? (half === "am" ? 0 : 12) : at < 12 && late ? at + 12 : at;
  }
  const rest = text.replace(SCHEDULE, " ").replace(/\s+/g, " ").trim().replace(/^(?:(?:hey\s+)?sona)?[,.\s]+/i, "").replace(LEAD_IN, "").replace(/[,.\s]+$/, "");
  return { question: rest.charAt(0).toUpperCase() + rest.slice(1), hour };
}

/** A sentence that asks Sona to keep asking: it opens or closes with its schedule ("Every morning at 7, …", "…, daily at 4pm"). */
export function isWatch(text: string) {
  const said = text.trim().replace(/^(?:hey\s+)?sona[,.\s]+/i, "");
  const at = SCHEDULE.exec(said);
  if (!at || !parseWatch(text).question) return false;
  return at.index === 0 || !said.slice(at.index + at[0].length).replace(/[\s,.?!]/g, "");
}

const DAY = 86_400_000, HOUR = 3_600_000;
/** The latest `hour`:00 in Malaysia at or before `now`. */
export function lastDue(hour: number, now: Date) {
  const today = malaysianDay(now) * DAY + (hour - 8) * HOUR;
  return new Date(today > now.getTime() ? today - DAY : today);
}
export const nextDue = (hour: number, now: Date) => new Date(lastDue(hour, now).getTime() + DAY);
