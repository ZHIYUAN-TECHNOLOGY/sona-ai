// Handoff for "start a new consult with this scanned document attached". Smart Scan
// lives outside the consult flow's PipelineProvider, so the review screen parks the
// doc id here, routes into the consent screen, and startConsult consumes it right
// after the consult row exists. Module-level on purpose — it survives the route
// transition and is cleared on read (a stale id must never attach to a later consult).

let pendingDocId: string | null = null;

/** Park a scanned document to be attached to the NEXT consult created. */
export function setPendingScanDoc(docId: string): void {
  pendingDocId = docId;
}

/** Take (and clear) the pending document id, if any. */
export function consumePendingScanDoc(): string | null {
  const id = pendingDocId;
  pendingDocId = null;
  return id;
}

/** Clear without attaching (consult flow abandoned before creation). */
export function clearPendingScanDoc(): void {
  pendingDocId = null;
}
