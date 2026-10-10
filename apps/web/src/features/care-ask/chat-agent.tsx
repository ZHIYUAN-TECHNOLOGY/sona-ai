import { CHAT_AGENT, askOver, type ChatAnswer, type ChatMessageLike } from "@sona-ai/api/chat-agent/client";
import { useAgentChat } from "agents/chat/react";
import { useAgent } from "agents/react";
import { useEffect, useRef } from "react";

/**
 * Ask Sona with conversation memory on the web (docs/chat-agent.md): her own chat agent on the server (agents/chat.ts),
 * which keeps the conversation, instead of care.ask. Loaded by the Ask page only when built with VITE_CARE_CHAT_AGENT=1.
 * `onAsk` gets the agent's ask once her stored conversation is read (the SDK suspends meanwhile: mount it in <Suspense>),
 * and none when the page goes. The socket is same-origin, so the session cookie signs it in.
 */
export default function ChatAgentLink({ user, onAsk }: { user: string; onAsk(ask: ((question: string) => Promise<ChatAnswer>) | undefined): void }) {
  const agent = useAgent({ agent: CHAT_AGENT, name: user });
  const finished = useRef<ChatMessageLike>(undefined);
  const chat = useAgentChat({ agent, credentials: "include", onFinish: ({ message }) => { finished.current = message; } });
  const latest = useRef(chat);
  latest.current = chat;
  useEffect(() => {
    onAsk(askOver(text => latest.current.sendMessage({ text }), finished));
    return () => onAsk(undefined);
  }, [onAsk]);
  return null;
}
