import { Directory, File, Paths } from "expo-file-system";
import { initWhisper, type WhisperContext } from "whisper.rn";

import type { SttSegment } from "./sttAlign";

// Real on-device speech-to-text via whisper.rn (whisper.cpp). Replaces the executorch Whisper,
// which forced a single language + exposed no hallucination controls → it emitted "(speaking in
// foreign language)" and repetition loops on Malaysian code-switched speech. whisper.cpp gives us:
//   - language AUTO-DETECT (no forced-en hallucination),
//   - whisper.cpp's built-in hallucination guards (temperature fallback, no_speech/entropy
//     thresholds, suppress_blank — all on by default) + beam search,
//   - segment timestamps for diarization alignment,
//   - raw float32 PCM IN MEMORY via transcribeData(ArrayBuffer) — audio never touches disk (moat).
//
// The ggml model IS downloaded (not PHI) to app storage on first use; the AUDIO is never written.

export interface Transcription {
  text: string;
  language: string;
  segments: SttSegment[];
}

/** ggml model tiers. Multilingual builds handle Malay/English/Mandarin far better than base-en. */
export interface WhisperModel {
  file: string; // local filename in the document dir
  url: string; // ggml .bin download source
}

// Phase 1 validation models (standard multilingual whisper.cpp ggml). Phase 2 swaps HIGH to a
// Mesolitica Malaysian-Whisper ggml (Manglish + Mandarin + Malay) at the same interface.
export const WHISPER_FAST: WhisperModel = {
  file: "ggml-base-q5.bin",
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin",
};
export const WHISPER_HIGH: WhisperModel = {
  file: "ggml-small-q5.bin",
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin",
};

/** The ggml model for an accuracy tier. */
export function whisperModelFor(accuracy: "fast" | "high"): WhisperModel {
  return accuracy === "high" ? WHISPER_HIGH : WHISPER_FAST;
}

/** Human label + approximate download size per tier (for Settings). */
export function whisperModelInfo(accuracy: "fast" | "high"): { name: string; size: string } {
  return accuracy === "high"
    ? { name: "Whisper-small (multilingual)", size: "~180MB" }
    : { name: "Whisper-base (multilingual)", size: "~60MB" };
}

let ctxPromise: Promise<WhisperContext> | null = null;
let loadedFile: string | null = null;

/** Download the ggml model to app storage if absent; return its local file path. */
async function ensureModel(model: WhisperModel, onProgress?: (p: number) => void): Promise<string> {
  const file = new File(Paths.document, model.file);
  if (file.exists) return file.uri;
  const downloaded = await File.downloadFileAsync(model.url, new Directory(Paths.document), {
    // File.downloadFileAsync names the file from the URL; rename to our stable name after.
  });
  // Normalize to our stable filename so lookups are deterministic across the URL's basename.
  if (downloaded.uri !== file.uri) {
    try {
      downloaded.move(file);
    } catch {
      // move unsupported / already there — fall back to the downloaded path
      onProgress?.(1);
      return downloaded.uri;
    }
  }
  onProgress?.(1);
  return file.uri;
}

async function getCtx(model: WhisperModel, onProgress?: (p: number) => void): Promise<WhisperContext> {
  // Switching tiers → release the old context first (one Whisper model resident at a time).
  if (ctxPromise && loadedFile !== model.file) {
    await unloadWhisper();
  }
  if (!ctxPromise) {
    loadedFile = model.file;
    ctxPromise = (async () => {
      const path = await ensureModel(model, onProgress);
      // useGpu → Metal on iOS. filePath accepts the file:// URI from expo-file-system.
      return initWhisper({ filePath: path, useGpu: true });
    })().catch((e) => {
      ctxPromise = null;
      loadedFile = null;
      throw e;
    });
  }
  return ctxPromise;
}

/**
 * Transcribe a mono 16 kHz float32 waveform on-device. Language defaults to auto-detect (the fix
 * for the forced-en hallucination); pass "en"/"ms"/"zh"/… to force one. Segments carry seconds.
 */
export async function transcribeWaveform(
  waveform: Float32Array,
  opts: { model?: WhisperModel; language?: string; onProgress?: (p: number) => void } = {},
): Promise<Transcription> {
  const model = opts.model ?? WHISPER_FAST;
  const ctx = await getCtx(model, opts.onProgress);
  // Pass raw float32 PCM in memory — no wav file, audio never persists.
  const pcm = waveform.buffer.slice(
    waveform.byteOffset,
    waveform.byteOffset + waveform.byteLength,
  ) as ArrayBuffer;
  const { promise } = ctx.transcribeData(pcm, {
    language: opts.language ?? "auto",
    translate: false,
    tokenTimestamps: true,
    // Hallucination guards: greedy at temp 0 with fallback increments; beam search for stability.
    temperature: 0,
    temperatureInc: 0.2,
    beamSize: 2,
    bestOf: 2,
    maxThreads: 4,
  });
  const res = await promise;
  // whisper.cpp segment timestamps t0/t1 are centiseconds (10ms) → seconds.
  const segments: SttSegment[] = (res.segments ?? [])
    .map((s) => ({ start: s.t0 / 100, end: s.t1 / 100, text: (s.text ?? "").trim() }))
    .filter((s) => s.text);
  const text = (res.result ?? "").trim();
  if (segments.length === 0 && text) segments.push({ start: 0, end: 0, text });
  return { text, language: res.language, segments };
}

/** Pre-download + load a tier's model (Settings pre-warm), reporting progress. */
export async function prewarmWhisper(model: WhisperModel, onProgress?: (p: number) => void): Promise<void> {
  await getCtx(model, onProgress);
  onProgress?.(1);
}

/** Release the whisper.cpp context + free its native memory. */
export async function unloadWhisper(): Promise<void> {
  const p = ctxPromise;
  ctxPromise = null;
  loadedFile = null;
  if (!p) return;
  try {
    const ctx = await p;
    await ctx.release();
  } catch {
    // load already failed — nothing to release
  }
}
