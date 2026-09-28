import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { formatDate, tFor, type Lang } from "@/lib/i18n";
import "./strings";

export type Message = Awaited<ReturnType<AppRouterClient["care"]["messages"]["list"]>>[number];
type Said = Pick<Message, "from" | "text">;

/** A reply waits when the care team spoke last and this phone has not shown that message yet. */
export function unreadReply(messages: Pick<Message, "id" | "from">[], lastReadId: string | undefined) {
  const last = messages.at(-1);
  return last?.from === "care-team" && last.id !== lastReadId;
}

/** The day a message falls on in the hospital's time (Malaysia), whatever the phone says. */
const dayKey = (at: Date | string) => new Date(at).toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
const dayName = (at: Date | string, now: Date, lang: Lang) => {
  const key = dayKey(at), t = tFor(lang);
  if (key === dayKey(now)) return t("msg.today");
  if (key === dayKey(new Date(now.getTime() - 86_400_000))) return t("msg.yesterday");
  return formatDate(lang, at, "day");
};
/** "10:05" in the hospital's time. */
export const clockOf = (at: Date | string) => formatDate("en", at, "hm");

/** The thread with a day pill ("Today", "Yesterday", "Fri 25 Sep") before the first message of each day. */
export function withDays<T extends Pick<Message, "createdAt">>(messages: T[], now: Date, lang: Lang = "en"): ({ day: string } | { message: T })[] {
  return messages.flatMap((m, i) => i > 0 && dayKey(messages[i - 1]!.createdAt) === dayKey(m.createdAt) ? [{ message: m }] : [{ day: dayName(m.createdAt, now, lang) }, { message: m }]);
}

/**
 * Words that mean the patient should not just wait for a reply, most serious first, each with what to
 * do meanwhile, in English, Malay or Chinese. ponytail: keyword match, so "no longer dizzy" still shows
 * the card (harmless: it only adds advice); a clinical triage model replaces it if the card starts showing too often.
 */
const CONCERNS: [RegExp, string][] = [
  [/chest (pain|hurts|tight)|pain in (my )?chest|sakit dada|dada (sakit|sesak|ketat)|胸痛|胸口(痛|闷)|胸闷/i, "msg.wait.chest"],
  [/breath|can'?t breathe|cannot breathe|wheez|sesak nafas|susah (nak )?bernafas|tak boleh bernafas|呼吸困难|喘不过气|气喘/i, "msg.wait.breath"],
  [/faint|passed out|blacked out|pengsan|晕倒|昏倒|昏过去/i, "msg.wait.faint"],
  [/bleed|berdarah|pendarahan|出血|流血/i, "msg.wait.bleed"],
  [/dizz|light.?headed|room.*spin|pening|pitam|头晕|头昏/i, "msg.wait.dizzy"],
];

/** What to do while waiting, when the patient's last word (unanswered) mentions a warning sign; otherwise nothing. */
export function whileYouWait(messages: Said[], lang: Lang = "en"): string | undefined {
  const last = messages.at(-1);
  if (last?.from !== "patient") return undefined;
  const key = CONCERNS.find(([words]) => words.test(last.text))?.[1];
  return key && tFor(lang)(key);
}

/**
 * Up to three likely next messages, from where the thread stands: answers to a care-team question,
 * follow-ups after the patient has just written, openers on an empty thread. Never the message the
 * patient just sent. Written in the patient's language, since they are sent as they are.
 */
export function suggestions(messages: Said[], lang: Lang = "en"): string[] {
  const t = tFor(lang), last = messages.at(-1);
  const picks = (!last ? ["question", "visit", "dizzy"]
    : last.from === "patient" ? ["thanks", "visit"]
      : /[?？]$/.test(last.text.trim()) ? ["going", "question", "dizzy"]
        : ["thanks", "question", "visit"]).map(k => t(`msg.s.${k}`));
  const lastMine = messages.findLast(m => m.from === "patient")?.text.trim().toLowerCase();
  return picks.filter(p => p.toLowerCase() !== lastMine).slice(0, 3);
}
