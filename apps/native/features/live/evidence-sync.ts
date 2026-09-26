import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { useEffect, useState } from "react";
import { api, errorText, useLive } from ".";

export type ServerEvidence = Awaited<ReturnType<AppRouterClient["evidence"]["ask"]>>;
// Answers already fetched this session, per request, so scrolling a card away and back does not ask again.
const answered = new Map<string, ServerEvidence>();

/** Live mode's evidence answer for one request; undefined data while it loads or when live mode is off. */
export function useLiveEvidence(encounterId: string, requestId: string | undefined, question: string) {
  const { on } = useLive();
  const key = requestId ?? `${encounterId}:${question}`;
  const [data, setData] = useState<ServerEvidence | undefined>(() => answered.get(key));
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!on || answered.has(key)) return;
    let current = true;
    api.evidence.ask({ encounterId, question }).then(r => { answered.set(key, r); if (current) setData(r); }, e => { if (current) setError(errorText(e)); });
    return () => { current = false; };
  }, [on, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { live: on, data: on ? data : undefined, error: on ? error : undefined };
}
