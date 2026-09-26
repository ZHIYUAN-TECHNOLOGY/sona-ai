import type { Encounter } from "@/features/encounter/types";
import { sectionKeys, type NoteSections } from "@/features/scribe/model";
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

/** One sentence per written note section, keyed by the section, so a code or claim can cite it. */
export const noteSentences = (sections: NoteSections) => sectionKeys.filter(key => sections[key].trim()).map(key => ({ id: key, text: sections[key].trim() }));
/** Sentences the app did not write (the seeded note) are kept in the subjective section. */
export function noteSections(sentences: { id: string; text: string }[]): NoteSections {
  const sections: NoteSections = { subjective: "", objective: "", assessment: "", plan: "" };
  for (const s of sentences) {
    const key = sectionKeys.find(k => k === s.id) ?? "subjective";
    sections[key] = [sections[key], s.text].filter(Boolean).join(key === s.id ? "\n" : " ");
  }
  return sections;
}
