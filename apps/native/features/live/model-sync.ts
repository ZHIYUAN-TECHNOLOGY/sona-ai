import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { useEffect, useState } from "react";
import { api, errorText, useLive } from ".";

/**
 * Live mode's model answers for the visit screens: briefing, reasoning, discharge draft, claim codes
 * and the huddle brief. Each reads its route on the server (models.ts: a labelled fixture until a
 * model is hosted, so `source` says which). Answers are kept per key for the session, so a card
 * scrolled away and back does not ask again; a key that changes (a new question, another language,
 * a fix added to the note) asks again. A late answer for a key that is no longer shown is dropped.
 */
type Client = AppRouterClient;
export type LiveBriefing = Awaited<ReturnType<Client["encounter"]["briefing"]>>;
export type LiveReasoning = Awaited<ReturnType<Client["encounter"]["reasoning"]>>;
export type LiveDraft = Awaited<ReturnType<Client["discharge"]["draft"]>>;
export type LiveCodes = Awaited<ReturnType<Client["claim"]["suggestCodes"]>>;
export type LiveAppeal = Awaited<ReturnType<Client["claim"]["appealDraft"]>>;
export type LiveHuddle =Awaited<ReturnType<Client["ward"]["huddle"]>>;

const answered = new Map<string, unknown>();

/**
 * One model answer by key; `ask` false (or live mode off) leaves data undefined so the screen shows its
 * fixture. `keep` shows the previous answer while a new key loads (the claim's codes after a fix), instead of the placeholder.
 */
function useLiveAnswer<T>(key: string, ask: boolean, read: () => Promise<T>, keep = false) {
  const { on } = useLive();
  const [state, setState] = useState<{ key: string; data?: T; error?: string; last?: T }>(() => ({ key, data: answered.get(key) as T | undefined }));
  useEffect(() => {
    if (!on || !ask) return;
    if (answered.has(key)) { setState(s => ({ key, data: answered.get(key) as T, last: s.data ?? s.last })); return; }
    let current = true;
    setState(s => (s.key === key ? s : { key, last: s.data ?? s.last }));
    read().then(r => { answered.set(key, r); if (current) setState({ key, data: r }); }, e => { if (current) setState(s => ({ key, error: errorText(e), last: s.last })); });
    return () => { current = false; };
  }, [on, ask, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = on && ask && state.key === key;
  const data = mine ? state.data ?? (keep ? state.last : undefined) : undefined;
  return { live: on, loading: on && ask && !data && !(mine && state.error), data, error: mine ? state.error : undefined };
}

export const useLiveBriefing = (encounterId: string) =>
  useLiveAnswer<LiveBriefing>(`briefing:${encounterId}`, true, () => api.encounter.briefing({ encounterId }));

/** Keyed by the request, so each asked question keeps its own answer. */
export const useLiveReasoning = (encounterId: string, requestId: string | undefined, question: string) =>
  useLiveAnswer<LiveReasoning>(`reasoning:${encounterId}:${requestId ?? question}`, true, () => api.encounter.reasoning({ encounterId, question }));

export const useLiveDraft = (encounterId: string, language: "ms" | "en" | "zh") =>
  useLiveAnswer<LiveDraft>(`draft:${encounterId}:${language}`, true, () => api.discharge.draft({ encounterId, language }));

/** `note` is whatever changes the note being coded (the claim's fixes), so a fix codes the new note. */
export const useLiveCodes = (encounterId: string, note: string) =>
  useLiveAnswer<LiveCodes>(`codes:${encounterId}:${note}`, Boolean(encounterId), () => api.claim.suggestCodes({ encounterId }), true);

/** The appeal against a denial; `denial` is when it was denied, so a later denial drafts again. */
export const useLiveAppeal = (encounterId: string, denial: string | undefined) =>
  useLiveAnswer<LiveAppeal>(`appeal:${encounterId}:${denial}`, Boolean(encounterId && denial), () => api.claim.appealDraft({ encounterId }));

/** Asked only once the brief is opened; `ward` is the ward's state (beds and owners), so a change briefs again. */
export const useLiveHuddle = (open: boolean, ward: string) =>
  useLiveAnswer<LiveHuddle>(`huddle:${ward}`, open, () => api.ward.huddle(), true);
