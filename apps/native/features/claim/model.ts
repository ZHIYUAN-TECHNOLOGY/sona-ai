import type { Sentence } from "@sona-ai/domain/claim";

export * from "@sona-ai/domain/claim";

/** The note with a fix's sentence saved to it: at the end, replacing an earlier answer to the same criterion. */
export const withFix = (note: Sentence[], fix: Sentence): Sentence[] => [...note.filter(s => s.id !== fix.id), fix];

let noteReads = 0;
/**
 * A number for one read of the visit's saved note, never given twice in a session. The codes are kept per read
 * (features/live/model-sync), and the sheet used to count its reads from 0 each time it opened: the second sitting's
 * first fix then got the first sitting's answer to "read 1", an older note with that criterion still open.
 */
export const nextNoteRead = () => ++noteReads;
