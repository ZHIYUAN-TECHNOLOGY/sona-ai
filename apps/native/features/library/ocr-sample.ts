/**
 * What server OCR (PaddleOCR-VL-1.6 on box ②, docs/delivery-plan.md "Scanned documents") will send back
 * for a scanned PDF, and the sample reading the review screen shows until that model is hosted. The
 * sample is a fixed synthetic protocol, never the doctor's own file, so nothing from it is saved.
 */
export type OcrLine = { text: string; confidence: number };
export type OcrPage = { page: number; confidence: number; lines: OcrLine[] };
/** A dose OCR found, checked against the drug table; "check" means outside the usual range, so possibly misread. */
export type OcrDose = { id: string; drug: string; dose: string; page: number; status: "in-range" | "check"; usual: string };
export type OcrReading = { source: "sample" } | { source: "model"; model: string };
export type OcrResult = OcrReading & { title: string; pages: OcrPage[]; doses: OcrDose[] };

/** Pages read with less confidence than this are left out rather than cited. */
export const CONFIDENCE_FLOOR = 0.8;
/** Words read with less confidence than this are tinted, so the eye lands on what may be wrong. */
export const WORD_FLOOR = 0.85;

export const SAMPLE_READING: OcrResult = {
  source: "sample",
  title: "Ward CAP protocol (scanned, synthetic)",
  pages: [
    { page: 1, confidence: 0.97, lines: [
      { text: "Ward CAP protocol (SYNTHETIC)", confidence: 0.99 },
      { text: "Adults admitted with community-acquired pneumonia.", confidence: 0.97 },
    ] },
    { page: 2, confidence: 0.95, lines: [
      { text: "1. Severity", confidence: 0.98 },
      { text: "Score CURB-65 on admission and again at 48 hours.", confidence: 0.94 },
    ] },
    { page: 3, confidence: 0.88, lines: [
      { text: "2. Antibiotics", confidence: 0.97 },
      { text: "Amoxicillin 7 g three times daily for five days.", confidence: 0.71 },
      { text: "Penicillin allergy: clarithromycin 500 mg twice daily.", confidence: 0.93 },
    ] },
    { page: 4, confidence: 0.62, lines: [
      { text: "3. Ster0ids", confidence: 0.58 },
      { text: "No rout1ne hydrocort- in non-severe pneu...", confidence: 0.61 },
    ] },
  ],
  doses: [
    { id: "d1", drug: "Amoxicillin", dose: "7 g", page: 3, status: "check", usual: "500 mg–1 g per dose" },
    { id: "d2", drug: "Clarithromycin", dose: "500 mg", page: 3, status: "in-range", usual: "250–500 mg per dose" },
  ],
};

/** The pages confident enough to add; the rest are left out, and their doses with them. */
export const keptPages = (r: OcrResult) => r.pages.filter(p => p.confidence >= CONFIDENCE_FLOOR);
