import { OCR_ENGLISH, OCRModule } from "react-native-executorch";

import { redactTranscript } from "../pipeline/redaction";

// On-device OCR (ExecuTorch CRAFT detector + CRNN recognizer). Reads text from a photo of a
// document — lab result, referral, medication label — locally; the image never leaves the
// phone. The English/Latin recognizer also reads Malay (same alphabet). Extracted text is
// treated as PHI: extractAndRedact runs it through the same de-identifier as the transcript,
// so only de-identified text can ever cross the boundary (the moat). Guarded — a build
// without the native module surfaces a clear error to the caller.

let ocrPromise: Promise<OCRModule> | null = null;

async function getOcr(onProgress?: (p: number) => void): Promise<OCRModule> {
  if (!ocrPromise) {
    ocrPromise = OCRModule.fromModelName(OCR_ENGLISH, onProgress).catch((e) => {
      ocrPromise = null; // let a transient failure retry
      throw e;
    });
  }
  return ocrPromise;
}

export interface OcrResult {
  /** Recognized text, detections joined in reading order. */
  text: string;
  /** Number of detected text boxes. */
  boxes: number;
}

/** Recognize text in an image (file URI). Runs fully on-device. */
export async function extractText(
  imageUri: string,
  opts: { onProgress?: (p: number) => void } = {},
): Promise<OcrResult> {
  const ocr = await getOcr(opts.onProgress);
  const detections = await ocr.forward(imageUri);
  const text = detections
    .map((d) => d.text.trim())
    .filter(Boolean)
    .join(" ");
  return { text, boxes: detections.length };
}

export interface RedactedOcr {
  /** Raw recognized text — device-only, never transmitted. */
  raw: string;
  /** De-identified text (tokens like NAME_1) — the only form that may cross the boundary. */
  redacted: string;
  /** High-confidence identifiers found + redacted. */
  identifiers: number;
}

/**
 * Extract text AND de-identify it. The raw text stays on-device; `redacted` is what may be
 * added to a note / sent on the optional cloud path. Same redactor as the consult transcript.
 */
export async function extractAndRedact(
  imageUri: string,
  opts: { onProgress?: (p: number) => void } = {},
): Promise<RedactedOcr> {
  const { text } = await extractText(imageUri, opts);
  const res = redactTranscript([{ speaker: "unknown", text }]);
  return { raw: text, redacted: res.segments[0]?.text ?? "", identifiers: res.highConfidenceCount };
}

/** Release the cached OCR model. */
export function disposeOcr(): void {
  ocrPromise = null;
}
