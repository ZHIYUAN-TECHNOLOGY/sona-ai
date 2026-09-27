import type { AppRouterClient } from "@sona-ai/api/routers/index";

export type Message = Awaited<ReturnType<AppRouterClient["care"]["messages"]["list"]>>[number];
type Said = Pick<Message, "from" | "text">;

/** What the care team's reply time looks like to the patient (no named person or promised hour: the data has neither). */
export const REPLY_TIME = "Usually replies within a few hours";

/** A reply waits when the care team spoke last and this phone has not shown that message yet. */
export function unreadReply(messages: Pick<Message, "id" | "from">[], lastReadId: string | undefined) {
  const last = messages.at(-1);
  return last?.from === "care-team" && last.id !== lastReadId;
}

/** Home's row line: a waiting reply first (with its opening words), then a sent message's status, else the emergency line. */
export function rowLine(messages: (Said & Pick<Message, "id">)[] | undefined, lastReadId: string | undefined): { line: string; tone: "muted" | "green" } {
  const last = messages?.at(-1);
  if (messages && unreadReply(messages, lastReadId)) return { line: `New reply · ${last!.text}`, tone: "green" };
  if (last?.from === "patient") return { line: `Sent · ${REPLY_TIME.toLowerCase()}`, tone: "muted" };
  return { line: "Not for emergencies · call 999", tone: "muted" };
}

/** The day a message falls on in the hospital's time (Malaysia), whatever the phone says. */
const dayKey = (at: Date | string) => new Date(at).toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
const dayName = (at: Date | string, now: Date) => {
  const key = dayKey(at);
  if (key === dayKey(now)) return "Today";
  if (key === dayKey(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return new Date(at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur" }).replace(",", "");
};
/** "10:05" in the hospital's time. */
export const clockOf = (at: Date | string) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" });

/** The thread with a day pill ("Today", "Yesterday", "Fri 25 Sep") before the first message of each day. */
export function withDays<T extends Pick<Message, "createdAt">>(messages: T[], now: Date): ({ day: string } | { message: T })[] {
  return messages.flatMap((m, i) => i > 0 && dayKey(messages[i - 1]!.createdAt) === dayKey(m.createdAt) ? [{ message: m }] : [{ day: dayName(m.createdAt, now) }, { message: m }]);
}

/**
 * Words that mean the patient should not just wait for a reply, most serious first, each with what to
 * do meanwhile. ponytail: keyword match, so "no longer dizzy" still shows the card (harmless: it only
 * adds advice); a clinical triage model replaces it if the card starts showing too often.
 */
const CONCERNS: [RegExp, string][] = [
  [/chest (pain|hurts|tight)|pain in (my )?chest/i, "Stop what you are doing and sit upright. Don't wait for a reply if it gets worse."],
  [/breath|can'?t breathe|cannot breathe|wheez/i, "Sit upright and breathe slowly. Don't wait for a reply if it gets worse."],
  [/faint|passed out|blacked out/i, "Lie down with your legs raised, and have someone stay with you."],
  [/bleed/i, "Press firmly on it with a clean cloth for 10 minutes."],
  [/dizz|light.?headed|room.*spin/i, "Sit or lie down, stand up slowly and drink some water."],
];

/** What to do while waiting, when the patient's last word (unanswered) mentions a warning sign; otherwise nothing. */
export function whileYouWait(messages: Said[]): string | undefined {
  const last = messages.at(-1);
  if (last?.from !== "patient") return undefined;
  return CONCERNS.find(([words]) => words.test(last.text))?.[1];
}

/**
 * Up to three likely next messages, from where the thread stands: answers to a care-team question,
 * follow-ups after the patient has just written, openers on an empty thread. Never the message the
 * patient just sent.
 */
export function suggestions(messages: Said[]): string[] {
  const last = messages.at(-1);
  const picks = !last ? ["I have a question about my medicine", "When is my next visit?", "I feel a bit dizzy"]
    : last.from === "patient" ? ["Thank you", "When is my next visit?"]
      : last.text.trim().endsWith("?") ? ["Going well, thank you", "I have a question about my medicine", "I feel a bit dizzy"]
        : ["Thank you", "I have a question about my medicine", "When is my next visit?"];
  const lastMine = messages.findLast(m => m.from === "patient")?.text.trim().toLowerCase();
  return picks.filter(p => p.toLowerCase() !== lastMine).slice(0, 3);
}
