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

/** A ggml model source: either a bundled app asset (offline) or a download URL. */
export interface WhisperModel {
  file: string; // stable local filename (download tier) / cache key
  url?: string; // ggml .bin download source (Fast tier)
  asset?: number; // require() id of a bundled ggml (ships in the app — offline, nothing downloads)
}

// FAST — standard multilingual whisper-base, downloaded once (small, quick, generic).
export const WHISPER_FAST: WhisperModel = {
  file: "ggml-base-q5.bin",
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin",
};

// HIGH — Mesolitica Malaysian Whisper-small (q5_1, 181MB), converted to ggml and BUNDLED in the
// app. Trained on Malay + Manglish + Mandarin + Tamil → the moat model for Malaysian consults.
// Bundled (not downloaded): ships offline, nothing leaves the device, instant (no download wait).
export const WHISPER_HIGH: WhisperModel = {
  file: "ggml-malaysian-small.bin",
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  asset: require("../../assets/models/ggml-malaysian-small.bin"),
};

/** The ggml model for an accuracy tier. */
export function whisperModelFor(accuracy: "fast" | "high"): WhisperModel {
  return accuracy === "high" ? WHISPER_HIGH : WHISPER_FAST;
}

/** Human label + source note per tier (for Settings). */
export function whisperModelInfo(accuracy: "fast" | "high"): { name: string; size: string } {
  return accuracy === "high"
    ? { name: "Malaysian Whisper-small", size: "bundled · offline" }
    : { name: "Whisper-base (multilingual)", size: "~60MB download" };
}

/** True if the tier's model ships in the app (no download needed). */
export function whisperIsBundled(accuracy: "fast" | "high"): boolean {
  return whisperModelFor(accuracy).asset != null;
}

let ctxPromise: Promise<WhisperContext> | null = null;
let loadedFile: string | null = null;

/** Download the ggml model to app storage if absent; return its local file path. */
async function ensureModel(model: WhisperModel, onProgress?: (p: number) => void): Promise<string> {
  if (!model.url) throw new Error("whisper model has no download URL");
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
      // Bundled model → load the app asset directly (offline, no download). useGpu → Metal.
      if (model.asset != null) {
        onProgress?.(1);
        return initWhisper({ filePath: model.asset, useGpu: true });
      }
      const path = await ensureModel(model, onProgress);
      // filePath accepts the file:// URI from expo-file-system.
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
  // whisper.rn's transcribeData reads the ArrayBuffer as INT16 PCM (or a WAV) — NOT float32
  // (despite the docs). Encode our 16 kHz mono float32 [-1,1] → int16 LE in memory (no wav file,
  // audio never persists). Passing float32 bytes made whisper read garbage → empty transcript.
  const pcm = floatTo16BitPcm(waveform);
  const { promise } = ctx.transcribeData(pcm, {
    language: opts.language ?? "auto",
    translate: false,
    // NOTE: tokenTimestamps makes whisper.cpp emit special timestamp tokens (<|0.0|>) into the
    // segment text — we only need SEGMENT t0/t1 (always present), so leave it off.
    // Hallucination guards: greedy at temp 0 with fallback increments; beam search for stability.
    temperature: 0,
    temperatureInc: 0.2,
    beamSize: 2,
    bestOf: 2,
    maxThreads: 4,
  });
  const res = await promise;
  // whisper.cpp segment timestamps t0/t1 are centiseconds (10ms) → seconds. Defensively strip any
  // Whisper special tokens (<|0.0|>, <|en|>, <|startoftranscript|>, …) that can leak into the text.
  const segments: SttSegment[] = (res.segments ?? [])
    .map((s) => ({ start: s.t0 / 100, end: s.t1 / 100, text: stripSpecialTokens(s.text ?? "") }))
    .filter((s) => s.text);
  const text = stripSpecialTokens(res.result ?? "");
  if (segments.length === 0 && text) segments.push({ start: 0, end: 0, text });
  return { text, language: res.language, segments };
}

/** Encode 16 kHz mono float32 [-1,1] PCM → int16 little-endian (what whisper.rn transcribeData reads). */
function floatTo16BitPcm(waveform: Float32Array): ArrayBuffer {
  const out = new Int16Array(waveform.length);
  for (let i = 0; i < waveform.length; i++) {
    const s = waveform[i] < -1 ? -1 : waveform[i] > 1 ? 1 : waveform[i];
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

/** Remove Whisper special tokens (<|…|>) and collapse whitespace. */
function stripSpecialTokens(s: string): string {
  return s
    .replace(/<\|[^>]*\|>/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
