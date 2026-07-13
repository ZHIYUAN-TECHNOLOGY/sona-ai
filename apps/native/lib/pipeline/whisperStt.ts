import { Asset } from "expo-asset";
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
  /** Raw whisper output BEFORE special-token stripping (diagnostics). */
  raw?: string;
}

/** A ggml model source: either a bundled app asset (offline) or a download URL. */
export interface WhisperModel {
  file: string; // stable local filename (download tier) / cache key
  url?: string; // ggml .bin download source (Fast tier)
  asset?: number; // require() id of a bundled ggml (ships in the app — offline, nothing downloads)
}

// Tier choice is EVIDENCE-BASED (bake-off on a real Malaysian consult clip, Jul 2026):
// official large-v3-turbo transcribed the code-switch best by far — perfect 中文 script + clean
// English (Mesolitica small/medium/distil all hallucinated on real far-field audio). See
// assets/models/REGENERATE.md.
//
// FAST — Mesolitica Malaysian Whisper-small (q5_1, 181MB), BUNDLED in the app: fully offline,
// instant, weaker accuracy. The no-network fallback.
export const WHISPER_FAST: WhisperModel = {
  file: "ggml-malaysian-small.bin",
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  asset: require("../../assets/models/ggml-malaysian-small.bin"),
};

// HIGH (default) — official Whisper large-v3-turbo (q5_0, 547MB), downloaded once from Hugging
// Face. Best Malaysian code-switch accuracy of everything tested; still fully on-device at
// inference (the download is the model, never the audio).
export const WHISPER_HIGH: WhisperModel = {
  file: "ggml-large-v3-turbo-q5_0.bin",
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
};

/** The ggml model for an accuracy tier. */
export function whisperModelFor(accuracy: "fast" | "high"): WhisperModel {
  return accuracy === "high" ? WHISPER_HIGH : WHISPER_FAST;
}

/** Human label + source note per tier (for Settings). */
export function whisperModelInfo(accuracy: "fast" | "high"): { name: string; size: string } {
  return accuracy === "high"
    ? { name: "Whisper large-v3-turbo", size: "547MB download" }
    : { name: "Malaysian Whisper-small", size: "bundled · offline" };
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
      // Bundled model: resolve the asset OURSELVES via expo-asset (downloadAsync → guaranteed
      // local file) instead of handing whisper.rn the require() id — its dev-mode asset handling
      // is unverified, and this lets us log the actual file the native side loads.
      let path: string;
      if (model.asset != null) {
        const asset = Asset.fromModule(model.asset);
        await asset.downloadAsync();
        if (!asset.localUri) throw new Error("model asset has no localUri after download");
        path = asset.localUri;
        onProgress?.(1);
      } else {
        path = await ensureModel(model, onProgress);
      }
      const filePath = path.startsWith("file://") ? path.slice(7) : path;
      try {
        const size = new File(path).size;
        console.log(`[WHISPER] model file: ${filePath} (${size ? Math.round(size / 1e6) : "?"}MB)`);
      } catch {
        console.log(`[WHISPER] model file: ${filePath} (size unknown)`);
      }
      // useGpu: earlier "Metal decodes garbage" runs were against a CORRUPT model file (the real
      // root cause — whisper.rn's dev-mode handling of a raw require() id). With the intact file,
      // Metal is expected fine and ~3-5× faster than CPU; the launch self-test verifies it.
      return initWhisper({ filePath, useGpu: true });
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
    // beam/bestOf 5 = the exact settings the Mac bake-off used (turbo Metal absorbs the cost).
    temperature: 0,
    temperatureInc: 0.2,
    beamSize: 5,
    bestOf: 5,
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
  return { text, language: res.language, segments, raw: res.result ?? "" };
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
