import type { Encounter } from "@/features/encounter/types";
import { api, requestId } from ".";

/**
 * Live mode for the prescribe card and the consultation note. The review stays the authored
 * fixture; the server records it and re-runs the eleven checks itself before it writes a receipt.
 */

/** Sends the card's eligibility and medicines to the server, then records the review at the revision that edit produced. */
export async function pushAndReview(encounterId: string, local: Encounter) {
  const { revision } = await api.encounter.get({ encounterId });
  const edited = await api.encounter.edit({
    encounterId, expectedRevision: revision, medicationEntries: local.medicationEntries ?? [],
    prescriptionInputs: local.prescriptionInputs, proposedMedicine: local.proposedMedicine,
  });
  return api.prescribing.review({ encounterId, expectedRevision: edited.revision });
}

export const simulateOnServer = (encounterId: string, approvedBy: string) => api.prescribing.simulate({ encounterId, requestId: requestId(), approvedBy });

/** Note sections as the server's sentences and back (shared with the server's scan.apply). */
export { noteSections, noteSentences } from "@sona-ai/domain/scan";
