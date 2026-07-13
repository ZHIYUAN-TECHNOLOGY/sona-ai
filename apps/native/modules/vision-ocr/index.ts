import { requireOptionalNativeModule } from "expo-modules-core";

// Apple Vision OCR (VNRecognizeTextRequest, .accurate + language correction) — the
// iOS text-recognition engine for Smart Scan. Local Expo module (./ios). Null on
// Android or before a rebuild links it — lib/vision/ocr.ts falls back to ML Kit.

export interface VisionOcrResult {
  /** Recognized text, lines joined top-to-bottom / left-to-right. */
  text: string;
  /** Number of recognized text lines. */
  boxes: number;
}

interface VisionOcrModule {
  recognize(uri: string): Promise<VisionOcrResult>;
}

export default requireOptionalNativeModule<VisionOcrModule>("VisionOcr");
