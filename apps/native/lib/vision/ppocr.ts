import { AlphaType, ColorType, Skia, type SkImage } from "@shopify/react-native-skia";
import { ExecutorchModule, ScalarType } from "react-native-executorch";

import {
  ctcDecode,
  dbnetBoxes,
  lineBreaksOf,
  pickDetBucket,
  pickRecBucket,
  REC_HEIGHT,
  rgbaToDetTensor,
  rgbaToRecTensor,
  type TextBox,
} from "./ppocrMath";

// PP-OCRv6 engine (software-mansion fused .pte, Apache-2.0) — PRIMARY OCR for Smart
// Scan; Apple Vision / ML Kit remain the automatic fallback (see ./ocr.ts). One 24MB
// model, one 18,709-char multilingual charset: Malay + English + 中文 in a single pass.
//
// The .pte exposes named bucket methods (detect_640/960/1280/640x1280,
// recognize_160..1280) — reachable through our runtime patch
// (patches/react-native-executorch@0.9.2.patch) which exposes
// nativeModule.execute(methodName, tensors). All pre/post-processing (Skia pixel I/O,
// DBNet box decode, CTC decode) is client-side per the model card; the pure math lives
// in ./ppocrMath (unit-tested).

const HF = "https://huggingface.co/software-mansion/react-native-executorch-pp-ocrv6/resolve/main";
const PTE_URL = `${HF}/PP-OCRv6_xnnpack.pte`;
const CHARSET_URL = `${HF}/charset.txt`;

/** Drop recognized lines below this confidence (model card's dropScore). */
const DROP_SCORE = 0.5;

// ImageNet-mean grey — the letterbox fill that normalizes to ~0 for the detector,
// matching PaddleOCR's zero-padding-after-normalize convention.
const DET_PAD_COLOR = Skia.Color("rgb(124,116,104)");
// 127.5-grey → ~0 under the recognizer's (x/127.5 - 1) normalization.
const REC_PAD_COLOR = Skia.Color("rgb(128,128,128)");

let modulePromise: Promise<ExecutorchModule> | null = null;
let charsetPromise: Promise<string[]> | null = null;

function getModule(onProgress?: (p: number) => void): Promise<ExecutorchModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const mod = new ExecutorchModule();
      await mod.load(PTE_URL, onProgress);
      return mod;
    })().catch((e) => {
      modulePromise = null; // transient failures may retry
      throw e;
    });
  }
  return modulePromise;
}

function getCharset(): Promise<string[]> {
  if (!charsetPromise) {
    charsetPromise = (async () => {
      const res = await fetch(CHARSET_URL);
      if (!res.ok) throw new Error(`charset fetch ${res.status}`);
      const arr = (await res.json()) as string[];
      if (!Array.isArray(arr) || arr.length < 1000) throw new Error("charset malformed");
      return arr;
    })().catch((e) => {
      charsetPromise = null;
      throw e;
    });
  }
  return charsetPromise;
}

async function loadImage(uri: string): Promise<SkImage> {
  const data = await Skia.Data.fromURI(uri);
  const img = Skia.Image.MakeImageFromEncoded(data);
  if (!img) throw new Error("PPOCR: could not decode image");
  return img;
}

/** Draw `img` letterboxed (top-left anchored) into a w×h surface; return RGBA bytes + snapshot. */
function rasterize(
  img: SkImage,
  w: number,
  h: number,
  padColor: ReturnType<typeof Skia.Color>,
  srcRect?: { x: number; y: number; w: number; h: number },
  dstW?: number,
): { rgba: Uint8Array; snapshot: SkImage; scale: number } {
  const surface = Skia.Surface.MakeOffscreen(w, h);
  if (!surface) throw new Error("PPOCR: offscreen surface failed");
  const canvas = surface.getCanvas();
  canvas.clear(padColor);
  const sx = srcRect ?? { x: 0, y: 0, w: img.width(), h: img.height() };
  const scale = dstW != null ? dstW / sx.w : Math.min(w / sx.w, h / sx.h);
  const dst = { x: 0, y: 0, width: sx.w * scale, height: dstW != null ? h : sx.h * scale };
  canvas.drawImageRect(
    img,
    { x: sx.x, y: sx.y, width: sx.w, height: sx.h },
    { x: dst.x, y: dst.y, width: Math.min(w, dst.width), height: Math.min(h, dst.height) },
    Skia.Paint(),
  );
  const snapshot = surface.makeImageSnapshot();
  const pixels = snapshot.readPixels(0, 0, {
    width: w,
    height: h,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  if (!pixels) throw new Error("PPOCR: readPixels failed");
  return { rgba: pixels as Uint8Array, snapshot, scale };
}

async function execute(
  mod: ExecutorchModule,
  method: string,
  data: Float32Array,
  sizes: number[],
): Promise<Float32Array> {
  // `execute` is our runtime patch (named-method inference on multi-method .pte files).
  const native = (mod as unknown as { nativeModule: { execute?: Function } }).nativeModule;
  if (!native?.execute) {
    throw new Error("PPOCR: runtime patch missing (execute) — falling back");
  }
  const outputs = await native.execute(method, [
    { dataPtr: data, sizes, scalarType: ScalarType.FLOAT },
  ]);
  const out = outputs?.[0];
  if (!out) throw new Error(`PPOCR: ${method} returned nothing`);
  const buf = out.dataPtr;
  return buf instanceof Float32Array
    ? buf
    : new Float32Array(buf.buffer ?? buf, buf.byteOffset ?? 0, (buf.byteLength ?? buf.length) / 4);
}

export interface PpocrResult {
  text: string;
  boxes: number;
}

/**
 * Full PP-OCRv6 pass over one image (local URI). Throws on any failure — the caller
 * (ocr.ts) treats every throw as "fall back to the platform engine".
 */
export async function ppocrExtractText(
  uri: string,
  onProgress?: (p: number) => void,
): Promise<PpocrResult> {
  const [mod, charset] = await Promise.all([getModule(onProgress), getCharset()]);
  const img = await loadImage(uri);

  // 1 · Detect: letterbox into the bucket canvas, run DBNet, decode boxes.
  const bucket = pickDetBucket(img.width(), img.height());
  const det = rasterize(img, bucket.w, bucket.h, DET_PAD_COLOR);
  const probMap = await execute(
    mod,
    bucket.method,
    rgbaToDetTensor(det.rgba, bucket.w, bucket.h),
    [1, 3, bucket.h, bucket.w],
  );
  const boxes = dbnetBoxes(probMap, bucket.w, bucket.h);
  if (boxes.length === 0) return { text: "", boxes: 0 };

  // 2 · Recognize each line crop (from the detect snapshot — same coordinate space).
  const breaks = lineBreaksOf(boxes);
  const pieces: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    const b: TextBox = boxes[i];
    const scaledW = Math.max(8, Math.round((b.w * REC_HEIGHT) / b.h));
    const rec = pickRecBucket(scaledW);
    const crop = rasterize(
      det.snapshot,
      rec.w,
      REC_HEIGHT,
      REC_PAD_COLOR,
      { x: b.x, y: b.y, w: b.w, h: b.h },
      Math.min(scaledW, rec.w),
    );
    const logits = await execute(
      mod,
      rec.method,
      rgbaToRecTensor(crop.rgba, rec.w, REC_HEIGHT),
      [1, 3, REC_HEIGHT, rec.w],
    );
    const T = rec.w / 8;
    const C = charset.length + 1;
    const { text, score } = ctcDecode(logits, T, C, charset);
    if (!text.trim() || score < DROP_SCORE) continue;
    pieces.push(`${breaks[i] ? "\n" : pieces.length ? " " : ""}${text.trim()}`);
  }
  const text = pieces.join("").trim();
  return { text, boxes: boxes.length };
}

/** Release the cached PP-OCR module (memory pressure / tier switch). */
export function disposePpocr(): void {
  void modulePromise?.then((m) => m.delete()).catch(() => {});
  modulePromise = null;
}
