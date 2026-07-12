import { SpeechToTextModule } from "react-native-executorch";

import { sttModelFor } from "./model";
import { getSttAccuracy, getSttLanguage } from "./sttMode";
import { alignTextToSpeakers, type SttSegment } from "./sttAlign";

// Real on-device speech-to-text (ExecuTorch Whisper). Transcribes a captured 16 kHz
// waveform locally — audio in, text out, nothing leaves the phone (the moat). Verbose mode
// returns per-segment timestamps so the pure aligner (./sttAlign) can join the text to the
// diarizer's speakers. The scripted mockStt stays the demo default; this is the real path,
// exercised from the Diarization Lab until it replaces the mock in the consult pipeline.

export { alignTextToSpeakers, langTag, speakerForSegment } from "./sttAlign";
export type { SttSegment };

export interface Transcription {
  text: string;
  language: string;
  segments: SttSegment[];
}

let sttPromise: Promise<SpeechToTextModule> | null = null;
let loadedModelName: string | null = null; // which tier the cached promise loaded

async function getStt(onProgress?: (p: number) => void): Promise<SpeechToTextModule> {
  const config = sttModelFor(getSttAccuracy());
  // If a DIFFERENT tier is cached (user flipped Fast↔High), free it first so we never hold
  // two Whisper models in RAM at once.
  if (sttPromise && loadedModelName !== config.modelName) {
    await unloadStt();
  }
  if (!sttPromise) {
    loadedModelName = config.modelName;
    // Clear the cache on a failed load so a transient error can retry.
    sttPromise = SpeechToTextModule.fromModelName(config, undefined, onProgress).catch((e) => {
      sttPromise = null;
      loadedModelName = null;
      throw e;
    });
  }
  return sttPromise;
}

// Serialize transcriptions — the native Whisper runner isn't reentrant, so concurrent
// transcribe() calls must not overlap. Each call chains after the previous one.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Transcribe a mono 16 kHz waveform on-device. Auto-detects language (BM/EN) unless one is
 * given. Falls back to a single whole-text segment if the model doesn't return timestamps.
 * Calls are serialized (the native runner is single-flight).
 */
export function transcribeAudio(
  waveform: Float32Array,
  opts: { language?: "ms" | "en"; onProgress?: (p: number) => void } = {},
): Promise<Transcription> {
  const run = queue.then(() => runTranscribe(waveform, opts));
  queue = run.then(
    () => {},
    () => {},
  ); // keep the chain alive regardless of outcome
  return run;
}

async function runTranscribe(
  waveform: Float32Array,
  opts: { language?: "ms" | "en"; onProgress?: (p: number) => void },
): Promise<Transcription> {
  const stt = await getStt(opts.onProgress);
  // The multilingual Whisper model REQUIRES a non-empty language — passing undefined throws
  // "Model is multilingual, provide a language". Fall back to the app's configured language.
  const language = opts.language ?? getSttLanguage();
  const res = await stt.transcribe(waveform, { language, verbose: true });
  const segments: SttSegment[] = (res.segments ?? [])
    .map((s) => ({ start: s.start, end: s.end, text: (s.text ?? "").trim() }))
    .filter((s) => s.text);
  if (segments.length === 0 && res.text?.trim()) {
    segments.push({ start: 0, end: res.duration ?? 0, text: res.text.trim() });
  }
  return { text: res.text, language: res.language, segments };
}

/**
 * Unload the STT model and FREE its native memory (module.delete()). Call after a consult's
 * transcription so whisper-small's ~1.1GB is released before the Qwen note/cleanup pass —
 * the two models never need to co-reside. Safe to call when nothing is loaded.
 */
export async function unloadStt(): Promise<void> {
  const p = sttPromise;
  sttPromise = null;
  loadedModelName = null;
  if (!p) return;
  try {
    const mod = await p;
    mod.delete(); // releases native tensors/buffers
  } catch {
    // load already failed — nothing native to free
  }
}

/**
 * Pre-download + load the CURRENT accuracy tier's model, reporting download progress (0..1).
 * Lets Settings pre-warm whisper-small (1.1GB) on wifi so the first High-accuracy consult
 * doesn't stall silently mid-transcription. Idempotent: a no-op (progress→1) if already loaded;
 * the on-disk download is one-time (later loads read the local cache).
 */
export async function prewarmStt(onProgress?: (p: number) => void): Promise<void> {
  await getStt(onProgress);
  onProgress?.(1);
}

/** Release the cached STT model (teardown). Frees native memory via unloadStt(). */
export function disposeStt(): void {
  void unloadStt();
}
