import { asAnswer, textOf, type ChatAnswer, type ChatMessageLike } from "@sona-ai/api/chat-agent/client";
import type { Lang } from "@/lib/i18n";
import { fromModel, urgent, type Asked, type PlanAnswer, type Reply } from "./answers";

/**
 * Ask Sona Care with conversation memory: the questions go to her own chat agent on the server (agents/chat.ts), which
 * keeps the conversation, instead of care.ask, which forgets each question once answered (docs/chat-agent.md). Off unless
 * the build sets EXPO_PUBLIC_CARE_CHAT_AGENT=1; off, nothing of it is mounted and Ask works as before. The screen keeps its
 * own UI: each answer comes back in care.ask's shape (asAnswer) and becomes a Reply as care.ask's do (replyOf).
 */
export const CHAT_AGENT_ON = process.env.EXPO_PUBLIC_CARE_CHAT_AGENT === "1";

export type CareChat = {
  /** One question to the agent, and its whole answer once it has finished streaming. */
  ask(question: string): Promise<ChatAnswer>;
  /** Her conversation as it was stored when the screen opened: each question with its answer, oldest first. */
  history: { question: string; answer: ChatAnswer }[];
  /** New chat: the agent forgets the conversation. */
  clear(): void;
};

/**
 * An answer as the screen shows it, as `answer` (./answers) makes one from care.ask: the 999 card for an emergency sign
 * (with "I've let your care team know." once the task is made), the plan's own answer to its suggested question while no
 * model answers, the doctors it found as cards, else the answer with where it came from.
 */
export function replyOf(question: string, a: ChatAnswer, asks: Asked[], lang: Lang): Reply {
  const told = a.careTeam ? { careTeam: a.careTeam } : {};
  if (urgent(question) || a.urgent) return { kind: "none", urgent: true, ...told };
  if (a.source !== "model" || !a.answer) {
    const asked = asks.find(s => s.question.toLowerCase() === question.trim().toLowerCase());
    return { ...asked ? { kind: "plan" as const, asked } : { kind: "none" as const, urgent: false }, ...a.waking ? { waking: Math.ceil(a.waking) } : {}, ...told };
  }
  if (a.doctors.length) return { kind: "doctors", doctors: a.doctors, text: a.answer };
  return { ...fromModel(a as unknown as PlanAnswer, lang), ...told };
}

/** Each question with the answer that followed it; a question with none (a turn cut off) is left out. */
export function pairs(messages: ChatMessageLike[]) {
  return messages.flatMap((m, i) => {
    const next = messages[i + 1];
    return m.role === "user" && next?.role === "assistant" ? [{ question: textOf(m), answer: asAnswer(next) }] : [];
  });
}
