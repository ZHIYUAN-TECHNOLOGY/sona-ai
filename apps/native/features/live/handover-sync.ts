import { useEffect, useState } from "react";
import type { HandoverCard } from "@/features/handover/model";
import { api, errorText, requestId, useLive } from ".";
import { useLiveChanges } from "./channel";
import { useRole } from "./roles";

/**
 * In live mode the handover stack is the server's cards (its patients only, no authored ward), and
 * "hold to accept" writes one acceptance. The request ID is fixed for the screen, so a retry after
 * a dropped answer replays the same acceptance instead of writing a second.
 */
export function useLiveHandover(enabled = true) {
  const { on } = useLive();
  // Bed managers may not read the handover; the screen says so instead of asking.
  const readable = useRole().can("handover.list");
  const [cards, setCards] = useState<HandoverCard[]>();
  const [error, setError] = useState<string>();
  const [id] = useState(requestId);
  // Live updates: an acceptance, a finding or a result elsewhere re-reads the cards.
  const [version, setVersion] = useState(0);
  useLiveChanges(["handover", "day", "findings"], () => setVersion(v => v + 1));
  useEffect(() => {
    if (!on || !readable || !enabled) return;
    let current = true;
    api.handover.list().then(list => { if (current) { setCards(list); setError(undefined); } }, e => { if (current) setError(errorText(e)); });
    return () => { current = false; };
  }, [on, readable, version, enabled]);
  /** Resolves to the server's acceptance time, or throws its refusal as readable text. */
  // `toUser` is the receiving clinician's user id (one of useHandoverReceivers), never a typed name.
  const accept = async (cardIds: string[], toUser: string) => {
    setError(undefined);
    try { return new Date((await api.handover.accept({ requestId: id, cardIds, toUser })).acceptedAt); }
    catch (e) { setError(errorText(e)); throw e; }
  };
  const retry = () => { setError(undefined); setVersion(v => v + 1); };
  return { live: on, cards, error, accept, retry };
}

export type HandoverReceiver = Awaited<ReturnType<typeof api.handover.receivers>>[number];

/**
 * Who the handover can go to: the hospital's own doctors and nurses, other than the one signed in (the server's
 * list; nobody is authored). Undefined until it arrives; a failed read is said with `retry`. Its own hook, so
 * the sidebar's card count does not read it.
 */
export function useHandoverReceivers(enabled = true) {
  const { on } = useLive();
  const allowed = useRole().can("handover.receivers");
  const [list, setList] = useState<HandoverReceiver[]>();
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!on || !allowed || !enabled) return;
    let current = true;
    api.handover.receivers().then(rows => { if (current) { setList(rows); setError(undefined); } }, e => { if (current) setError(errorText(e)); });
    return () => { current = false; };
  }, [on, allowed, version, enabled]);
  return { list, error, retry: () => { setError(undefined); setVersion(v => v + 1); } };
}
