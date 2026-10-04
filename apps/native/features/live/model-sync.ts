import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { useEffect, useState } from "react";
import { api, errorText, useLive } from ".";
import { askUntilAwake } from "./waking";

/**
 * Live mode's model answers for the visit screens: briefing, reasoning, discharge draft, claim codes
 * and the huddle brief. Each reads its route on the server (models.ts: a labelled fixture until a
 * model is hosted, so `source` says which). A model's answers are kept per key for the session, so a card
 * scrolled away and back does not ask again; a key that changes (a new question, another language,
 * a fix added to the note) asks again. A late answer for a key that is no longer shown is dropped.
 */
type Client = AppRouterClient;
export type LiveBriefing = Awaited<ReturnType<Client["encounter"]["briefing"]>>;
export type LiveReasoning = Awaited<ReturnType<Client["encounter"]["reasoning"]>>;
export type LiveDraft = Awaited<ReturnType<Client["discharge"]["draft"]>>;
export type LiveCodes = Awaited<ReturnType<Client["claim"]["suggestCodes"]>>;
export type LiveAppeal = Awaited<ReturnType<Client["claim"]["appealDraft"]>>;
export type LiveHuddle = Awaited<ReturnType<Client["ward"]["huddle"]>>;
export type LiveXray = Awaited<ReturnType<Client["xray"]["read"]>>;

const answered = new Map<string, unknown>();
// Asks in flight, so two screens reading one answer (a card and its lead) ask once.
const asking = new Map<string, Promise<unknown>>();

/**
 * One model answer by key; `ask` false (or live mode off) leaves data undefined so the screen shows its
 * fixture. `keep` shows the previous answer while a new key loads (the claim's codes after a fix), instead of the placeholder;
 * `stale` says that is what `data` is (an answer to the previous key, the new ask still in flight or failed).
 * `retry` asks this key again, for a card whose ask failed or came back as the server's stub.
 */
function useLiveAnswer<T>(key: string, ask: boolean, read: () => Promise<T>, keep = false) {
  const { on } = useLive();
  const [state, setState] = useState<{ key: string; data?: T; error?: string; last?: T }>(() => ({ key, data: answered.get(key) as T | undefined }));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!on || !ask) return;
    if (answered.has(key)) { setState(s => ({ key, data: answered.get(key) as T, last: s.data ?? s.last })); return; }
    setState(s => (s.key === key ? s : { key, last: s.data ?? s.last }));
    // While the model starts, its sample shows and is asked again until the model answers (./waking).
    return askUntilAwake(() => {
      if (answered.has(key)) return Promise.resolve(answered.get(key) as T); // another screen's ask got the model's answer
      const pending = (asking.get(key) ?? read().then(r => {
        // Only a model's answer is kept: a sample (the model was starting, or failed) is asked again on the next open.
        if ((r as { source?: string }).source !== "fixture") answered.set(key, r);
        return r;
      })) as Promise<T>;
      asking.set(key, pending);
      void pending.finally(() => asking.delete(key)).catch(() => {});
      return pending;
    }, r => setState({ key, data: r }), e => setState(s => ({ key, error: errorText(e), last: s.last })));
  }, [on, ask, key, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = on && ask && state.key === key;
  const data = mine ? state.data ?? (keep ? state.last : undefined) : undefined;
  return {
    live: on, loading: on && ask && !data && !(mine && state.error), data, error: mine ? state.error : undefined,
    stale: Boolean(mine && keep && !state.data && state.last),
    // Clears this key's failure or stub so the card drafts again, then asks (a model's answer already kept comes straight back).
    retry: () => { setState(s => (s.key === key ? { key, last: s.last } : s)); setAttempt(a => a + 1); },
  };
}

export const useLiveBriefing = (encounterId: string) =>
  useLiveAnswer<LiveBriefing>(`briefing:${encounterId}`, true, () => api.encounter.briefing({ encounterId }));

/** Keyed by the request, so each asked question keeps its own answer. */
export const useLiveReasoning = (encounterId: string, requestId: string | undefined, question: string) =>
  useLiveAnswer<LiveReasoning>(`reasoning:${encounterId}:${requestId ?? question}`, true, () => api.encounter.reasoning({ encounterId, question }));

/** Kept while another language drafts (`stale`), so the card's summary holds its height; the caller never shows that draft's leaflet as the new language's. */
export const useLiveDraft = (encounterId: string, language: "ms" | "en" | "zh") =>
  useLiveAnswer<LiveDraft>(`draft:${encounterId}:${language}`, true, () => api.discharge.draft({ encounterId, language }), true);

/** `note` names one read of the saved note (the claim's nextNoteRead: never reused, since the note itself is only known to the server), so a fix codes the new note. */
export const useLiveCodes = (encounterId: string, note: string) =>
  useLiveAnswer<LiveCodes>(`codes:${encounterId}:${note}`, Boolean(encounterId), () => api.claim.suggestCodes({ encounterId }), true);

/** The appeal against a denial; `denial` is when it was denied, so a later denial drafts again. */
export const useLiveAppeal = (encounterId: string, denial: string | undefined) =>
  useLiveAnswer<LiveAppeal>(`appeal:${encounterId}:${denial}`, Boolean(encounterId && denial), () => api.claim.appealDraft({ encounterId }));

/** Asked only once the brief is opened; `ward` is the ward's state (beds and owners), so a change briefs again. */
export const useLiveHuddle = (open: boolean, ward: string) =>
  useLiveAnswer<LiveHuddle>(`huddle:${ward}`, open, () => api.ward.huddle(), true);

/** The image model's reading of the visit's uploaded X-ray; `image` is the attachment shown, so a new image reads again. Never a validated read. */
export const useLiveXray = (encounterId: string, image: string | undefined) =>
  useLiveAnswer<LiveXray>(`xray:${encounterId}:${image}`, Boolean(encounterId && image), () => api.xray.read({ encounterId }));
