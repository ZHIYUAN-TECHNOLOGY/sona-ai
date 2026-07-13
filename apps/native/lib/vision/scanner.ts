import { File } from "expo-file-system";
import DocumentScanner, {
  ResponseType,
  ScanDocumentResponseStatus,
} from "react-native-document-scanner-plugin";

// Native document scanner — VisionKit on iOS (the Apple Notes scanner), ML Kit document
// scanner on Android. Live edge detection, auto-capture, perspective-corrected crop; the
// flattened crop reads far better under OCR than a raw handheld photo. Multi-page in one
// session. Images are written to the app sandbox and never leave the phone.

/** Max pages per scan — protects OCR latency and the small note model's context. */
export const MAX_SCAN_PAGES = 5;

/**
 * Open the native scanner and return local file URIs of the cropped pages, capped at
 * MAX_SCAN_PAGES (extra pages are dropped, the caller can tell from the count). Returns
 * [] when the user cancels or the scanner is unavailable (e.g. Android without GMS) —
 * callers fall back to the photo-library path.
 */
export async function scanDocumentPages(): Promise<string[]> {
  try {
    const res = await DocumentScanner.scanDocument({
      croppedImageQuality: 90,
      responseType: ResponseType.ImageFilePath,
      maxNumDocuments: MAX_SCAN_PAGES, // Android-only cap; iOS is capped by the slice below
    });
    if (res.status !== ScanDocumentResponseStatus.Success) return [];
    const pages = (res.scannedImages ?? []).filter(Boolean);
    // Pages beyond the cap are never OCR'd — destroy them now, not just drop the URIs
    // (the scanner writes JPEGs into the app's Documents dir; orphans persist forever).
    deletePageImages(pages.slice(MAX_SCAN_PAGES));
    return pages.slice(0, MAX_SCAN_PAGES);
  } catch {
    return [];
  }
}

/**
 * Destroy scanned page-image files. Called the moment OCR is done (success or not):
 * the verified text is the record, the image is PHI with no further use — and the
 * scanner writes into Documents, so anything not deleted here lives forever. Silent
 * per-file: a missing file must never break the scan flow.
 */
export function deletePageImages(uris: string[]): void {
  for (const uri of uris) {
    try {
      new File(uri).delete();
    } catch {
      // already gone — nothing to destroy
    }
  }
}
