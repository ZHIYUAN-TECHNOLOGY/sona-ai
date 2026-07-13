import TextRecognition from "@react-native-ml-kit/text-recognition";
import { Platform } from "react-native";

import VisionOcr from "../../modules/vision-ocr";
import { redactDocText, type RedactedDocText } from "./ocrText";

// On-device OCR — the engine seam for Smart Scan. iOS: Apple Vision
// (VNRecognizeTextRequest, .accurate + language correction — best print accuracy,
// usable handwriting, correct reading order; see modules/vision-ocr). Android, or an
// iOS build that predates the module: ML Kit text recognition (in the app binary, no
// download). Both fully on-device; the image never leaves the phone. Extracted text is
// treated as PHI — see ./ocrText for the de-identification half (pure, unit-tested).
// Everything downstream sees only `extractText()`, so engines swap freely.

export { joinPages, redactDocText, type RedactedDocText } from "./ocrText";

export interface OcrResult {
  /** Recognized text, lines/blocks joined in reading order (newline-separated). */
  text: string;
  /** Number of detected text lines/blocks. */
  boxes: number;
}

/** Recognize text in one image (local file URI). Runs fully on-device. */
export async function extractText(imageUri: string): Promise<OcrResult> {
  const uri = normalizeUri(imageUri);
  if (Platform.OS === "ios" && VisionOcr) {
    try {
      return await VisionOcr.recognize(uri);
    } catch (e) {
      console.log(`[OCR] Vision failed → ML Kit fallback: ${String(e)}`);
    }
  }
  const result = await TextRecognition.recognize(uri);
  const text = result.blocks
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join("\n");
  return { text, boxes: result.blocks.length };
}

// ML Kit's native layer wants a URL-ish path; bare /var/... paths fail on iOS.
function normalizeUri(uri: string): string {
  return uri.startsWith("file://") || uri.includes("://") ? uri : `file://${uri}`;
}

/**
 * Recognize a multi-page document. Pages are OCR'd sequentially (each call is native
 * and fast, ~100-300ms); `onPage(i, total)` reports progress. Returns per-page text.
 */
export async function extractPages(
  pageUris: string[],
  onPage?: (page: number, total: number) => void,
): Promise<string[]> {
  const texts: string[] = [];
  for (let i = 0; i < pageUris.length; i++) {
    onPage?.(i + 1, pageUris.length);
    const { text } = await extractText(pageUris[i]);
    texts.push(text);
  }
  return texts;
}

export interface RedactedOcr extends RedactedDocText {
  /** Raw recognized text — device-only, never transmitted. */
  raw: string;
}

/** Extract text AND de-identify it — single-image convenience (used by the OCR lab). */
export async function extractAndRedact(imageUri: string): Promise<RedactedOcr> {
  const { text } = await extractText(imageUri);
  return { raw: text, ...redactDocText(text) };
}
