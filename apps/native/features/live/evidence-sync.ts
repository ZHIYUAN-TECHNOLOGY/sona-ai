import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { useEffect, useState, useSyncExternalStore } from "react";
import { api, errorText, useLive } from ".";
import { askUntilAwake, wakingOf } from "./waking";

export type ServerEvidence = Awaited<ReturnType<AppRouterClient["evidence"]["ask"]>>;
export type Turn = { question: string; answer: string };
/** What the answer has done so far, as the server reports it: searched, read what it found, and (a model's answer) writing. */
export type EvidenceStep = { step: "search" } | { step: "read"; studies: number; passages: number } | { step: "write" };
type Claim = ServerEvidence["claims"][number];
/** What of the answer is written so far, while it is written: its bottom line, and its claims as each is checked. */
export type Written = { bottomLine?: string; claims: Claim[]; references?: ServerEvidence["references"] };
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

type Ask = Parameters<AppRouterClient["evidence"]["ask"]>[0];
/**
 * One answer, read as the server sends it: each step goes to `onStep` as it happens (searching, reading, writing), what is
 * written so far to `onPart` (the bottom line, then each checked claim), and the whole answer comes last. A phone that
 * cannot read the stream gets the same answer in one piece.
 */
async function streamed(input: Ask, onStep: (steps: EvidenceStep[]) => void, onPart: (written: Written) => void): Promise<ServerEvidence> {
  const steps: EvidenceStep[] = [];
  let written: Written = { claims: [] };
  try {
    for await (const event of await api.evidence.stream(input)) {
      if (event.type === "answer") return event.answer;
      if (event.type === "bottomLine") { written = { ...written, bottomLine: event.text }; onPart(written); continue; }
      if (event.type === "claim") { written = { ...written, claims: [...written.claims, event.claim] }; onPart(written); continue; }
      // The sources are known once read, so a claim written later shows its citations' strength and proof at once.
      if (event.step === "read") written = { ...written, references: event.references };
      steps.push(event.step === "read" ? { step: "read", studies: event.studies, passages: event.passages } : { step: event.step });
      onStep([...steps]);
    }
  } catch { /* asked again below, in one piece */ }
  return api.evidence.ask(input);
}

/**
 * Live mode's evidence answer for one question, and what it has done so far (`steps`); undefined data while it loads or
 * when live mode is off. `encounterId` makes it the visit's (the patient's CURB-65); without one it is asked from
 * anywhere. `thread` is sent once, with the first ask. `key` names the request, so its answer is kept for the session.
 */
export function useLiveEvidence(encounterId: string | undefined, key: string, question: string, thread: Turn[]) {
  const { on } = useLive();
  const [data, setData] = useState<ServerEvidence | undefined>(() => answered.get(key));
  const [steps, setSteps] = useState<EvidenceStep[]>([]);
  const [written, setWritten] = useState<Written>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!on || answered.has(key)) return;
    // A sample while the model starts is shown, not kept: it is asked again until the model answers (./waking), and on the next open.
    return askUntilAwake(() => streamed({ encounterId, question, thread }, setSteps, setWritten).then(r => {
      if (!wakingOf(r)) { answered = new Map(answered).set(key, r); listeners.forEach(l => l()); }
      return r;
    }), setData, e => setError(errorText(e)));
  }, [on, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { live: on, data: on ? data : undefined, steps, written: on && !data ? written : undefined, error: on ? error : undefined };
}
