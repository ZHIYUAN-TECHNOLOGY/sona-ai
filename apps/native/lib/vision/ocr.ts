import TextRecognition from "@react-native-ml-kit/text-recognition";

import { redactDocText, type RedactedDocText } from "./ocrText";

// On-device OCR via ML Kit text recognition — models ship inside the app binary, so
// recognition works instantly on a fresh install (no download, unlike the earlier
// ExecuTorch CRAFT+CRNN spike). The Latin recognizer reads English and Malay; the image
// never leaves the phone. Extracted text is treated as PHI — see ./ocrText for the
// de-identification half (pure, unit-tested). This module is the engine seam: swapping
// recognizers (Apple Vision, executorch) changes nothing downstream.

export { joinPages, redactDocText, type RedactedDocText } from "./ocrText";

export interface OcrResult {
  /** Recognized text, blocks joined in reading order (newline-separated). */
  text: string;
  /** Number of detected text blocks. */
  boxes: number;
}

/** Recognize text in one image (local file URI). Runs fully on-device. */
export async function extractText(imageUri: string): Promise<OcrResult> {
  const result = await TextRecognition.recognize(normalizeUri(imageUri));
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
