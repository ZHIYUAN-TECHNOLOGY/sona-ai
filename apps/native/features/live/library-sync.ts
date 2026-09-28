import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { api, errorText, requestId, useLive } from ".";

export type LibraryDocument = Awaited<ReturnType<AppRouterClient["library"]["list"]>>[number];
export type LibraryScope = "me" | "hospital";
export type ArticlePreview = Awaited<ReturnType<AppRouterClient["library"]["previewArticle"]>>;
export type Added = Awaited<ReturnType<AppRouterClient["library"]["add"]>> & { pages?: number };

/** The doctor's library in live mode: their own sources and the hospital's shared ones. Re-read whenever the screen comes back into view (after the add sheet closes). */
export function useLiveLibrary() {
  const { on } = useLive();
  const [docs, setDocs] = useState<LibraryDocument[]>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const refresh = useCallback(() => { if (on) api.library.list().then(setDocs, e => setError(errorText(e))); }, [on]);
  useFocusEffect(refresh);
  const remove = async (documentId: string) => {
    setPending(true); setError(undefined);
    try { await api.library.remove({ documentId }); refresh(); } catch (e) { setError(errorText(e)); } finally { setPending(false); }
  };
  return { live: on, docs, error, pending, remove };
}

/** A PDF picked on the phone, read as base64 (the server reads its text and does not keep the file). */
async function base64Of(uri: string) {
  const blob = await (await fetch(uri)).blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(new Error("The file could not be read"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Adding one source. The request ID stays the same until an add succeeds, so a retry after a dropped
 * answer replaces rather than duplicates. Refusals come back as the server's words (patient details,
 * a scan with no text, PubMed down), for the sheet to show in place.
 */
export function useAddSource() {
  const [id, setId] = useState(requestId);
  const run = async (write: (requestId: string) => Promise<Added>): Promise<{ added: Added } | { error: string; retryable: boolean }> => {
    try { const added = await write(id); setId(requestId()); return { added }; }
    // A refusal about the source itself (patient details, a scan) fails the same way again; a dropped or busy server may not.
    catch (e) { return { error: errorText(e), retryable: !["BAD_REQUEST", "NOT_FOUND", "CONFLICT", "FORBIDDEN"].includes((e as { code?: string }).code ?? "") }; }
  };
  return {
    pdf: (scope: LibraryScope, file: { uri: string; name: string }) => run(async requestId =>
      api.library.addPdf({ requestId, scope, title: file.name.replace(/\.pdf$/i, "").trim() || "Untitled PDF", dataBase64: await base64Of(file.uri) })),
    text: (scope: LibraryScope, title: string, text: string) => run(requestId =>
      api.library.add({ requestId, scope, title, text, source: scope === "me" ? "Added by you" : "Added by your hospital", year: new Date().getFullYear() })),
    article: (scope: LibraryScope, pmid: string) => run(requestId => api.library.importArticle({ requestId, scope, pmid })),
    preview: (ref: string) => api.library.previewArticle({ ref }).then(preview => ({ preview }), (e: unknown) => ({ error: errorText(e) })),
  };
}
