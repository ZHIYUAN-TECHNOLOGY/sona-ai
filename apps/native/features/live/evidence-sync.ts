import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { useEffect, useState, useSyncExternalStore } from "react";
import { api, errorText, useLive } from ".";

export type ServerEvidence = Awaited<ReturnType<AppRouterClient["evidence"]["ask"]>>;
export type Turn = { question: string; answer: string };
// Answers already fetched this session, per request, so scrolling a card away and back does not ask again.
// Replaced (never mutated) on each answer, so the visit's lead re-renders with it (useAnsweredEvidence).
let answered = new Map<string, ServerEvidence>();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
/** Every live evidence answer so far, by request: the visit's one-line lead reads the same answer its card shows. */
export const useAnsweredEvidence = () => useSyncExternalStore(subscribe, () => answered);

/** The earlier evidence turns of this encounter (at most 4, oldest first), each answer as its claims joined, from this session's cache. */
export function threadBefore(requests: { id: string; kind: string; prompt: string }[], requestId: string | undefined): Turn[] {
  const at = requests.findIndex(r => r.id === requestId);
  return (at < 0 ? [] : requests.slice(0, at)).filter(r => r.kind === "evidence")
    .map(r => ({ question: r.prompt, answer: answered.get(r.id)?.claims.map(c => c.text).join(" ") ?? "" })).slice(-4);
}

/** Live mode's evidence answer for one request; undefined data while it loads or when live mode is off. `thread` is sent once, with the first ask. */
export function useLiveEvidence(encounterId: string, requestId: string | undefined, question: string, thread: Turn[]) {
  const { on } = useLive();
  const key = requestId ?? `${encounterId}:${question}`;
  const [data, setData] = useState<ServerEvidence | undefined>(() => answered.get(key));
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!on || answered.has(key)) return;
    let current = true;
    api.evidence.ask({ encounterId, question, thread }).then(r => { answered = new Map(answered).set(key, r); listeners.forEach(l => l()); if (current) setData(r); }, e => { if (current) setError(errorText(e)); });
    return () => { current = false; };
  }, [on, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { live: on, data: on ? data : undefined, error: on ? error : undefined };
}
