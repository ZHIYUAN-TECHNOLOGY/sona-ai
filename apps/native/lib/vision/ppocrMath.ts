// Pure math for the PP-OCRv6 client pipeline (software-mansion fused .pte). The model
// file contains ONLY tensor ops — resize/normalize, DBNet box decoding and CTC decoding
// are the client's job (per the model card). This module is native-free and unit-tested
// (ppocrMath.test.ts); the device half (Skia pixels + executorch calls) lives in ppocr.ts.
//
// Interface map (introspected from PP-OCRv6_xnnpack.pte, Jul 2026):
//   detect_640 / detect_960 / detect_1280 : (1,3,S,S)  f32 → (1,1,S,S) prob map
//   detect_640x1280                       : (1,3,1280,640) portrait variant
//   recognize_{160,320,480,640,1280}      : (1,3,48,W) f32 → (1,W/8,18710) logits
//   charset: 18,709 entries; logits C=18710 → CTC blank = index 0, char i = charset[i-1].

export const DET_BUCKETS = [640, 960, 1280] as const;
export const REC_BUCKETS = [160, 320, 480, 640, 1280] as const;
export const REC_HEIGHT = 48;

/** Pick the detect method + canvas size for an image. Portrait pages get 640x1280. */
export function pickDetBucket(w: number, h: number): { method: string; w: number; h: number } {
  if (h / w >= 1.5 && h > 640) return { method: "detect_640x1280", w: 640, h: 1280 };
  const side = Math.max(w, h);
  const s = DET_BUCKETS.find((b) => b >= side) ?? 1280;
  return { method: `detect_${s}`, w: s, h: s };
}

/** Pick the recognize method for a crop scaled to height 48. */
export function pickRecBucket(scaledWidth: number): { method: string; w: number } {
  const w = REC_BUCKETS.find((b) => b >= scaledWidth) ?? 1280;
  return { method: `recognize_${w}`, w };
}

// PaddleOCR preprocessing: detection uses ImageNet stats; recognition uses (x/127.5 - 1).
const DET_MEAN = [0.485, 0.456, 0.406];
const DET_STD = [0.229, 0.224, 0.225];

/** RGBA bytes (HWC) → normalized CHW float32 for a detect_* method. */
export function rgbaToDetTensor(rgba: Uint8Array, w: number, h: number): Float32Array {
  const out = new Float32Array(3 * w * h);
  const plane = w * h;
  for (let i = 0; i < plane; i++) {
    const r = rgba[i * 4] / 255;
    const g = rgba[i * 4 + 1] / 255;
    const b = rgba[i * 4 + 2] / 255;
    out[i] = (r - DET_MEAN[0]) / DET_STD[0];
    out[plane + i] = (g - DET_MEAN[1]) / DET_STD[1];
    out[2 * plane + i] = (b - DET_MEAN[2]) / DET_STD[2];
  }
  return out;
}

/** RGBA bytes (HWC) → normalized CHW float32 for a recognize_* method. */
export function rgbaToRecTensor(rgba: Uint8Array, w: number, h: number): Float32Array {
  const out = new Float32Array(3 * w * h);
  const plane = w * h;
  for (let i = 0; i < plane; i++) {
    out[i] = rgba[i * 4] / 127.5 - 1;
    out[plane + i] = rgba[i * 4 + 1] / 127.5 - 1;
    out[2 * plane + i] = rgba[i * 4 + 2] / 127.5 - 1;
  }
  return out;
}

export interface TextBox {
  /** Axis-aligned box in detect-canvas pixels, unclip margin applied. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Mean probability inside the component (0..1). */
  score: number;
}

/**
 * DBNet postprocess: probability map → text boxes. Threshold → connected components
 * (BFS) → per-component bbox + mean score → unclip expansion. Axis-aligned on purpose:
 * inputs come from the document scanner's perspective-corrected crop, so rotated text
 * is rare and the simpler geometry is robust. Pure + tested.
 */
export function dbnetBoxes(
  prob: Float32Array,
  w: number,
  h: number,
  opts: { thresh?: number; boxThresh?: number; unclip?: number; minSize?: number } = {},
): TextBox[] {
  const { thresh = 0.3, boxThresh = 0.6, unclip = 1.6, minSize = 3 } = opts;
  const labels = new Int32Array(w * h); // 0 = unvisited
  const boxes: TextBox[] = [];
  const stack = new Int32Array(w * h);
  let nextLabel = 1;

  for (let start = 0; start < w * h; start++) {
    if (labels[start] !== 0 || prob[start] < thresh) continue;
    // BFS this component.
    let top = 0;
    stack[top++] = start;
    labels[start] = nextLabel;
    let minX = w, maxX = 0, minY = h, maxY = 0, sum = 0, count = 0;
    while (top > 0) {
      const p = stack[--top];
      const px = p % w;
      const py = (p / w) | 0;
      sum += prob[p];
      count++;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      // 4-neighbourhood
      if (px > 0 && labels[p - 1] === 0 && prob[p - 1] >= thresh) { labels[p - 1] = nextLabel; stack[top++] = p - 1; }
      if (px < w - 1 && labels[p + 1] === 0 && prob[p + 1] >= thresh) { labels[p + 1] = nextLabel; stack[top++] = p + 1; }
      if (py > 0 && labels[p - w] === 0 && prob[p - w] >= thresh) { labels[p - w] = nextLabel; stack[top++] = p - w; }
      if (py < h - 1 && labels[p + w] === 0 && prob[p + w] >= thresh) { labels[p + w] = nextLabel; stack[top++] = p + w; }
    }
    nextLabel++;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const score = sum / count;
    if (bw < minSize || bh < minSize || score < boxThresh) continue;
    // DBNet unclip: expand by margin = area * unclip / perimeter (Vatti approximation).
    const margin = Math.round((bw * bh * unclip) / (2 * (bw + bh)));
    const x = Math.max(0, minX - margin);
    const y = Math.max(0, minY - margin);
    boxes.push({
      x,
      y,
      w: Math.min(w - x, bw + 2 * margin),
      h: Math.min(h - y, bh + 2 * margin),
      score,
    });
  }
  return sortReadingOrder(boxes);
}

/** Sort boxes top→bottom, grouping into lines (centres within half line-height), then left→right. */
export function sortReadingOrder(boxes: TextBox[]): TextBox[] {
  const sorted = [...boxes].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const lines: TextBox[][] = [];
  for (const b of sorted) {
    const cy = b.y + b.h / 2;
    const line = lines.find((l) => {
      const ref = l[0];
      return Math.abs(ref.y + ref.h / 2 - cy) < Math.max(ref.h, b.h) * 0.6;
    });
    if (line) line.push(b);
    else lines.push([b]);
  }
  return lines.flatMap((l) => l.sort((a, b) => a.x - b.x));
}

/** Group already-sorted boxes into visual lines (same tolerance as sortReadingOrder). */
export function lineBreaksOf(boxes: TextBox[]): boolean[] {
  const breaks: boolean[] = [];
  for (let i = 0; i < boxes.length; i++) {
    if (i === 0) { breaks.push(false); continue; }
    const prev = boxes[i - 1];
    const cur = boxes[i];
    breaks.push(
      Math.abs(prev.y + prev.h / 2 - (cur.y + cur.h / 2)) >= Math.max(prev.h, cur.h) * 0.6,
    );
  }
  return breaks;
}

export interface CtcResult {
  text: string;
  /** Mean softmax probability of the emitted characters (0..1). */
  score: number;
}

/**
 * Greedy CTC decode. `logits` shape (T, C) row-major, C = charset.length + 1,
 * blank = index 0, char i = charset[i-1]. Confidence = mean softmax prob of the
 * kept (non-blank, deduplicated) steps.
 */
export function ctcDecode(logits: Float32Array, T: number, C: number, charset: string[]): CtcResult {
  let text = "";
  let prev = -1;
  let scoreSum = 0;
  let kept = 0;
  for (let t = 0; t < T; t++) {
    const off = t * C;
    let best = 0;
    let bestV = logits[off];
    for (let c = 1; c < C; c++) {
      const v = logits[off + c];
      if (v > bestV) { bestV = v; best = c; }
    }
    if (best !== 0 && best !== prev) {
      // softmax prob of the winner (stable: subtract max = bestV)
      let denom = 0;
      for (let c = 0; c < C; c++) denom += Math.exp(logits[off + c] - bestV);
      scoreSum += 1 / denom;
      kept++;
      text += charset[best - 1] ?? "";
    }
    prev = best;
  }
  return { text, score: kept ? scoreSum / kept : 0 };
}
