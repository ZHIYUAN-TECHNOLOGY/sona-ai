import type { Doctor } from "@sona-ai/domain/doctors";

import { unnumbered, type Source } from "../leaflets";

/**
 * Ask Sona Care with conversation memory: the chat agent (apps/server/src/agents/chat.ts, one per patient, the conversation
 * kept in its own storage), behind each app's flag (docs/chat-agent.md). Off, the apps ask care.ask as before. This file is
 * what the server and the apps share, and imports nothing that runs on the server, so the apps can import it.
 */

/** The agent's route: /agents/sona-chat-agent/<signed-in user id> (a WebSocket, and GET …/get-messages). */
export const CHAT_AGENT = "sona-chat-agent";

/** What the agent attaches to each of its answers (the message's metadata), in care.ask's own words. */
export type ChatMeta = {
  /** "model": Sona Med wrote it; "fixture": Sona's own line (no model, or it is starting: `waking` minutes). */
  source: "model" | "fixture"; model?: string; waking?: number;
  /** Her record was read for this answer. */
  grounded: boolean;
  /** She reported an emergency sign now: the 999 card leads the answer. */
  urgent: boolean;
  /** The hospital's leaflets the answer used, by title. */
  sources: Source[];
  /** The care team's flagged task, there only once it is made, with Sona's line saying so in her language. */
  careTeam?: { taskId: string; title: string; line: string };
  /** The doctors the answer found (the hospital's directory), for the app's doctor cards. */
  doctors?: Doctor[];
};

/** A chat message as both the server (the AI SDK's UIMessage) and the apps hold it. */
export type ChatMessageLike = { role: string; parts: { type: string; text?: string }[]; metadata?: unknown };

/**
 * One of the agent's answers as care.ask returns its answer, so each app reads it with the code it already has (captions,
 * the 999 card, "I've let your care team know."), plus the doctors it found. The words lose the leaflet numbers ("[1]")
 * the model cites them by.
 */
export function asAnswer(message: ChatMessageLike) {
  const meta: Partial<ChatMeta> = typeof message.metadata === "object" && message.metadata ? message.metadata : {};
  return {
    answer: unnumbered(textOf(message)).trim(), grounded: meta.grounded === true, urgent: meta.urgent === true, sources: meta.sources ?? [],
    withheld: 0, source: meta.source ?? "fixture", model: meta.model, waking: meta.waking, careTeam: meta.careTeam, doctors: meta.doctors ?? [],
  };
}
export type ChatAnswer = ReturnType<typeof asAnswer>;

/**
 * Asking through the SDK's chat hook (useAgentChat): `send` is its sendMessage, which settles once the answer has finished
 * streaming, and `finished` holds the answer its onFinish last gave. One question at a time, so each answer is its own
 * question's; no answer (the socket is down) reads as care.ask's fixture, and each app says it cannot answer.
 */
export function askOver(send: (text: string) => Promise<unknown>, finished: { current?: ChatMessageLike }) {
  let line: Promise<unknown> = Promise.resolve();
  return (question: string) => {
    const asked = line.then(async () => {
      finished.current = undefined;
      await send(question);
      return finished.current;
    }).catch(() => undefined).then(message => asAnswer(message ?? { role: "assistant", parts: [] }));
    line = asked;
    return asked;
  };
}

/** The words of a message (a patient's question, or an answer as written). */
export const textOf = (message: ChatMessageLike) => message.parts.filter(p => p.type === "text").map(p => p.text ?? "").join("").trim();
