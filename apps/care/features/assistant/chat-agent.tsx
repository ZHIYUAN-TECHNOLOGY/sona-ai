import { CHAT_AGENT, askOver, type ChatMessageLike } from "@sona-ai/api/chat-agent/client";
import { useAgentChat } from "agents/chat/react";
import { useAgent } from "agents/react";
import { fetch as nativeFetch } from "expo/fetch";
import { getRandomValues, randomUUID } from "expo-crypto";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { ENV } from "@/src/env";
import { pairs, type CareChat } from "./agent-replies";

// The SDK's socket and requests are named with Web Crypto (crypto.randomUUID, nanoid's getRandomValues), which React
// Native does not have: expo-crypto's stand in where missing, before anything here connects.
const web = globalThis as { crypto?: Partial<Crypto> };
web.crypto ??= {};
web.crypto.getRandomValues ??= getRandomValues as Crypto["getRandomValues"];
web.crypto.randomUUID ??= randomUUID as Crypto["randomUUID"];

/**
 * Her chat agent (./agent-replies), for the Ask screen: `onChat` gets it once her stored conversation is read, and none
 * again when the screen goes. Renders nothing. The socket signs in with the session cookie, as the live call's does
 * (lib/live-voice/session). Mounted only when the build's flag is on (CHAT_AGENT_ON).
 */
export function CareChatLink({ onChat }: { onChat(chat: CareChat | undefined): void }) {
  const user = authClient.useSession().data?.user.id;
  const [cookie, setCookie] = useState<string>();
  useEffect(() => { void Promise.resolve().then(() => authClient.getCookie()).then(c => setCookie(c || ""), () => setCookie("")); }, [user]);
  if (!user || cookie === undefined) return null;
  // The SDK reads the stored conversation by suspending; nothing shows meanwhile, and Ask asks care.ask until it is in.
  return <Suspense fallback={null}><Agent user={user} cookie={cookie} onChat={onChat} /></Suspense>;
}

function Agent({ user, cookie, onChat }: { user: string; cookie: string; onChat(chat: CareChat | undefined): void }) {
  const server = new URL(ENV.EXPO_PUBLIC_SERVER_URL);
  const headers = useMemo((): Record<string, string> => cookie ? { Cookie: cookie } : {}, [cookie]);
  // React Native's WebSocket takes headers as a third argument.
  const WithCookie = useMemo(() => class extends (WebSocket as unknown as new (url: string, protocols: string | string[] | undefined, options: { headers: Record<string, string> }) => WebSocket) {
    constructor(url: string, protocols?: string | string[]) { super(url, protocols, { headers }); }
  }, [headers]);
  const agent = useAgent({ agent: CHAT_AGENT, name: user, host: server.host, protocol: server.protocol === "https:" ? "wss" : "ws", WebSocket: WithCookie });
  const finished = useRef<ChatMessageLike>(undefined);
  const chat = useAgentChat({
    agent,
    getInitialMessages: () => nativeFetch(`${server.origin}/agents/${CHAT_AGENT}/${encodeURIComponent(user)}/get-messages`, { headers })
      .then(res => res.ok ? res.json() : [], () => []),
    onFinish: ({ message }) => { finished.current = message; },
  });
  const latest = useRef(chat);
  latest.current = chat;
  useEffect(() => {
    onChat({
      history: pairs(latest.current.messages),
      ask: askOver(text => latest.current.sendMessage({ text }), finished),
      clear: () => latest.current.clearHistory(),
    });
    return () => onChat(undefined);
  }, [onChat]);
  return null;
}
