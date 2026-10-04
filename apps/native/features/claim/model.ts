import type { Sentence } from "@sona-ai/domain/claim";

export * from "@sona-ai/domain/claim";

/** The note with a fix's sentence saved to it: at the end, replacing an earlier answer to the same criterion. */
export const withFix = (note: Sentence[], fix: Sentence): Sentence[] => [...note.filter(s => s.id !== fix.id), fix];
