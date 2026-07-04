// Sona export module: pure, offline note export.
//
// - types:  SignedNote / Soap (local; reconcile with persistence later)
// - fhir:   toFhirDocumentReference  -> FHIR R4 DocumentReference (plain object)
// - html:   toNoteHtml               -> printable HTML string
// - noteText: toNoteText             -> canonical plain-text body
// - pdf:    exportPdf                -> file uri (lazy-loads expo-print)
//
// Functions 1-3 are pure and native-free; only exportPdf touches a device.

export type { SignedNote, Soap } from "./types";
export { toNoteText, base64EncodeUtf8, SECTION_HEADERS } from "./noteText";
export { toFhirDocumentReference } from "./fhir";
export { toNoteHtml } from "./html";
export { exportPdf } from "./pdf";
