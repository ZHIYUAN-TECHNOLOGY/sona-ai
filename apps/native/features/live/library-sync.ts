import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { useEffect, useState } from "react";
import { api, errorText, requestId, useLive } from ".";

export type LibraryDocument = Awaited<ReturnType<AppRouterClient["library"]["list"]>>[number];

/**
 * The hospital's own library in live mode: list, add pasted text, remove. The request ID stays
 * the same until an add succeeds, so retrying after a dropped answer replaces rather than duplicates.
 */
export function useLiveLibrary() {
  const { on } = useLive();
  const [docs, setDocs] = useState<LibraryDocument[]>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [id, setId] = useState(requestId);
  const refresh = () => api.library.list().then(setDocs, e => setError(errorText(e)));
  useEffect(() => { if (on) void refresh(); }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (write: () => Promise<unknown>) => {
    setPending(true); setError(undefined);
    try { await write(); await refresh(); return true; } catch (e) { setError(errorText(e)); return false; } finally { setPending(false); }
  };
  const add = (title: string, text: string) => run(async () => {
    await api.library.add({ requestId: id, title, text, source: "Added by your hospital", year: new Date().getFullYear() });
    setId(requestId());
  });
  const remove = (documentId: string) => run(() => api.library.remove({ documentId }));
  return { live: on, docs, error, pending, add, remove };
}
