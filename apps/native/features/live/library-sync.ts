import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { api, errorText, requestId, useLive } from ".";
import { useLiveChanges } from "./channel";
import { titleOf, type PageType } from "./picked";

export type LibraryDocument = Awaited<ReturnType<AppRouterClient["library"]["list"]>>[number];
export type LibraryScope = "me" | "hospital";
export type ArticlePreview = Awaited<ReturnType<AppRouterClient["library"]["previewArticle"]>>;
/** `read: "scan"` when MedGemma read the pages (a scanned PDF or photos), so the doctor is asked to check the text. */
export type Added = Awaited<ReturnType<AppRouterClient["library"]["add"]>> & { pages?: number; read?: "scan" };

// TODO(merge): use api.library.addImages once the server lands, and drop this wrapper.
type AddImagesInput = { requestId: string; scope: LibraryScope; title: string; images: { dataBase64: string; contentType: PageType }[] };
const addImages = (input: AddImagesInput): Promise<Added> => (api.library as any).addImages(input);

/** The doctor's library in live mode: their own sources and the hospital's shared ones. Re-read whenever the screen comes back into view (after the add sheet closes) or a colleague changes it. */
export function useLiveLibrary() {
  const { on } = useLive();
  const [docs, setDocs] = useState<LibraryDocument[]>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const refresh = useCallback(() => { if (on) api.library.list().then(setDocs, e => setError(errorText(e))); }, [on]);
  useFocusEffect(refresh);
  useLiveChanges(["library"], refresh);
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
  const run = async (write: (requestId: string) => Promise<Added>): Promise<{ added: Added } | { error: string; retryable: boolean; reason?: string }> => {
    try { const added = await write(id); setId(requestId()); return { added }; }
    // A refusal about the source itself (patient details, a scan) fails the same way again; a dropped or busy server may not.
    catch (e) {
      const { code, data } = e as { code?: string; data?: { reason?: string } };
      return { error: errorText(e), retryable: !["BAD_REQUEST", "NOT_FOUND", "CONFLICT", "FORBIDDEN"].includes(code ?? ""), reason: data?.reason };
    }
  };
  return {
    pdf: (scope: LibraryScope, file: { uri: string; name: string }) => run(async requestId =>
      api.library.addPdf({ requestId, scope, title: titleOf(file.name) || "Untitled PDF", dataBase64: await base64Of(file.uri) })),
    /** Photos of printed pages, in the order picked, as one source titled after the first. */
    images: (scope: LibraryScope, files: { file: { uri: string; name: string }; contentType: PageType }[]) => run(async requestId =>
      addImages({ requestId, scope, title: titleOf(files[0]?.file.name ?? "") || "Untitled pages",
        images: await Promise.all(files.map(async ({ file, contentType }) => ({ dataBase64: await base64Of(file.uri), contentType }))) })),
    text: (scope: LibraryScope, title: string, text: string) => run(requestId =>
      api.library.add({ requestId, scope, title, text, source: scope === "me" ? "Added by you" : "Added by your hospital", year: new Date().getFullYear() })),
    article: (scope: LibraryScope, pmid: string) => run(requestId => api.library.importArticle({ requestId, scope, pmid })),
    preview: (ref: string) => api.library.previewArticle({ ref }).then(preview => ({ preview }), (e: unknown) => ({ error: errorText(e) })),
  };
}
