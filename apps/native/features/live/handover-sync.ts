import { useEffect, useState } from "react";
import type { HandoverCard } from "@/features/handover/model";
import { api, errorText, requestId, useLive } from ".";
import { useLiveChanges } from "./channel";

/**
 * In live mode the handover stack is the server's cards (its patients only, no authored ward), and
 * "hold to accept" writes one acceptance. The request ID is fixed for the screen, so a retry after
 * a dropped answer replays the same acceptance instead of writing a second.
 */
export function useLiveHandover() {
  const { on } = useLive();
  const [cards, setCards] = useState<HandoverCard[]>();
  const [error, setError] = useState<string>();
  const [id] = useState(requestId);
  // Live updates: an acceptance, a finding or a result elsewhere re-reads the cards.
  const [version, setVersion] = useState(0);
  useLiveChanges(["handover", "day", "findings"], () => setVersion(v => v + 1));
  useEffect(() => {
    if (!on) return;
    let current = true;
    api.handover.list().then(list => { if (current) setCards(list); }, e => { if (current) setError(errorText(e)); });
    return () => { current = false; };
  }, [on, version]);
  /** Resolves to the server's acceptance time, or throws its refusal as readable text. */
  const accept = async (cardIds: string[], toUser: string) => {
    setError(undefined);
    try { return new Date((await api.handover.accept({ requestId: id, cardIds, toUser })).acceptedAt); }
    catch (e) { setError(errorText(e)); throw e; }
  };
  return { live: on, cards, error, accept };
}
