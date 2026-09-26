import type { CheckIn, ReplyLabel } from "@sona-ai/domain/check-ins";
import type { Language } from "@sona-ai/domain/discharge";

/** How the patient says they feel; the answer control hands this to `onAnswer` with the words it sends. */
export type Feeling = "better" | "same" | "worse";
export type { CheckIn, ReplyLabel };

/**
 * What the home's feature card shows: the check-in waiting for an answer (due or already sent, not
 * answered), else the next one to come, else nothing (both answered).
 */
export function todayOf(checkIns: CheckIn[], now: Date): { ask?: CheckIn; next?: CheckIn } {
  const open = checkIns.filter(c => !c.replies.length);
  const ask = open.find(c => c.sentAt || c.dueAt <= now);
  if (ask) return { ask };
  const next = open.find(c => c.dueAt > now);
  return next ? { next } : {};
}

// Short and plain; the English line under a Malay or Chinese question helps a family member reading along.
const COPY: Record<Language, { question: string; answers: [string, Feeling][]; more: string; placeholder: string; send: string }> = {
  en: { question: "How are you feeling today?", answers: [["Better", "better"], ["About the same", "same"], ["Worse", "worse"]], more: "Tell us more", placeholder: "How are you feeling?", send: "Send" },
  ms: { question: "Macam mana hari ini?", answers: [["Lebih baik", "better"], ["Sama", "same"], ["Lebih teruk", "worse"]], more: "Ceritakan lebih lanjut", placeholder: "Tulis di sini", send: "Hantar" },
  zh: { question: "今天感觉怎么样？", answers: [["好一些", "better"], ["差不多", "same"], ["更差", "worse"]], more: "多说一点", placeholder: "在这里写", send: "发送" },
};

export function answersFor(language: Language) {
  return { ...COPY[language], english: language === "en" ? undefined : "How are you today?" };
}

/** The card's done state, from how the care team's side read the answer (never from the button alone). */
export function doneLine(label: ReplyLabel): { text: string; tone: "muted" | "amber" } {
  return label === "fine"
    ? { text: "Thanks, your care team can see this.", tone: "muted" }
    : { text: "Your care team has been told. If it gets worse, call 999.", tone: "amber" };
}

/** A past check-in's one line of state: how the answer was read and whether the care team has acted. */
export function statusOf(checkIn: CheckIn, now: Date): { line: string; tone: "muted" | "blue" | "amber" | "green" } {
  const reply = checkIn.replies.at(-1);
  if (!reply) return checkIn.sentAt || checkIn.dueAt <= now ? { line: "Waiting for your answer", tone: "blue" } : { line: `Coming ${shortDate(checkIn.dueAt)}`, tone: "muted" };
  if (reply.label === "fine") return { line: "All fine · your care team can see it", tone: "muted" };
  return reply.task?.completed ? { line: "Your care team followed up", tone: "green" } : { line: "Your care team was told", tone: "amber" };
}

/** "Mon 28 Sep" in the hospital's time zone. */
export const shortDate = (at: Date) =>
  new Date(at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur" });
