import { SignedNote } from "./types";
import { toNoteHtml } from "./html";

// Render a signed note to a PDF file on-device and return its file:// uri.
//
// expo-print is a native module, so it is required lazily. This keeps the pure
// functions (toNoteText, toFhirDocumentReference, toNoteHtml) importable and
// unit-testable in plain Node without a device or the native module installed.
export async function exportPdf(note: SignedNote): Promise<string> {
  // Lazy require so importing this file never pulls in the native module until
  // the PDF path is actually exercised on a device.
  const Print = require("expo-print") as typeof import("expo-print");
  const { uri } = await Print.printToFileAsync({ html: toNoteHtml(note) });
  return uri;
}
