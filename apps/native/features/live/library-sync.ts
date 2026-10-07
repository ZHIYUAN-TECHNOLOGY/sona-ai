import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { api, errorText, requestId, useLive } from ".";
import { useLiveChanges } from "./channel";
import type { PageType, ScanRead } from "./picked";

export type LibraryDocument = Awaited<ReturnType<AppRouterClient["library"]["list"]>>[number];
export type LibraryScope = "me" | "hospital";
export type ArticlePreview = Awaited<ReturnType<AppRouterClient["library"]["previewArticle"]>>;
/** `pages`: how many checked pages a scan added. */
export type Added = Awaited<ReturnType<AppRouterClient["library"]["add"]>> & { pages?: number };
type Failure = { error: string; retryable: boolean; reason?: string };
// TODO(merge): use api.library.readScan/addScan once the server lands
const scanApi = api.library as unknown as {
  readScan(input: { pdf: { dataBase64: string } } | { images: { dataBase64: string; contentType: PageType }[] }): Promise<ScanRead>;
  addScan(input: { requestId: string; scope: LibraryScope; title: string; source: ScanRead["source"]; model: string; pages: string[] }): Promise<Added & { pages: number }>;
};

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
  // A refusal about the source itself (patient details, a scan) fails the same way again; a dropped or busy server may not.
  const failure = (e: unknown): Failure => {
    const { code, data } = e as { code?: string; data?: { reason?: string } };
    return { error: errorText(e), retryable: !["BAD_REQUEST", "NOT_FOUND", "CONFLICT", "FORBIDDEN"].includes(code ?? ""), reason: data?.reason };
  };
  const run = async (write: (requestId: string) => Promise<Added>): Promise<{ added: Added } | Failure> => {
    try { const added = await write(id); setId(requestId()); return { added }; } catch (e) { return failure(e); }
  };
  return {
    /** A text PDF. A scan is refused with `reason: "scan"`, and is then read for review with `read`. */
    pdf: (scope: LibraryScope, title: string, uri: string) => run(async requestId =>
      api.library.addPdf({ requestId, scope, title, dataBase64: await base64Of(uri) })),
    /** A scanned PDF or photos of printed pages (in the order picked), read by MedGemma for the doctor to check. Saves nothing. */
    read: async (source: { pdf: string } | { images: { file: { uri: string }; contentType: PageType }[] }): Promise<{ read: ScanRead } | Failure> => {
      try {
        return { read: await scanApi.readScan("pdf" in source ? { pdf: { dataBase64: await base64Of(source.pdf) } }
          : { images: await Promise.all(source.images.map(async ({ file, contentType }) => ({ dataBase64: await base64Of(file.uri), contentType }))) }) };
      } catch (e) { return failure(e); }
    },
    /** The text the doctor checked, page by page, under the same request ID as the upload. */
    scan: (scope: LibraryScope, title: string, read: ScanRead, pages: string[]) => run(requestId =>
      scanApi.addScan({ requestId, scope, title, source: read.source, model: read.model, pages })),
    text: (scope: LibraryScope, title: string, text: string) => run(requestId =>
      api.library.add({ requestId, scope, title, text, source: scope === "me" ? "Added by you" : "Added by your hospital", year: new Date().getFullYear() })),
    article: (scope: LibraryScope, pmid: string) => run(requestId => api.library.importArticle({ requestId, scope, pmid })),
    preview: (ref: string) => api.library.previewArticle({ ref }).then(preview => ({ preview }), (e: unknown) => ({ error: errorText(e) })),
  };
}
