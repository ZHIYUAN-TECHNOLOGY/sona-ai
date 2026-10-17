export * from "@sona-ai/domain/claim";

let noteReads = 0;
/**
 * A number for one read of the visit's saved note, never given twice in a session. The codes are kept per read
 * (features/live/model-sync), and the sheet used to count its reads from 0 each time it opened: the second sitting's
 * first fix then got the first sitting's answer to "read 1", an older note with that criterion still open.
 */
export const nextNoteRead = () => ++noteReads;
