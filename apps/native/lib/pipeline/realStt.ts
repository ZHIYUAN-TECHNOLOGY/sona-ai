import { SpeechToTextModule } from "react-native-executorch";

import { STT_MODEL } from "./model";
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

async function getStt(onProgress?: (p: number) => void): Promise<SpeechToTextModule> {
  if (!sttPromise) {
    // Clear the cache on a failed load so a transient error can retry.
    sttPromise = SpeechToTextModule.fromModelName(STT_MODEL, undefined, onProgress).catch((e) => {
      sttPromise = null;
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
  const res = await stt.transcribe(waveform, { language: opts.language, verbose: true });
  const segments: SttSegment[] = (res.segments ?? [])
    .map((s) => ({ start: s.start, end: s.end, text: (s.text ?? "").trim() }))
    .filter((s) => s.text);
  if (segments.length === 0 && res.text?.trim()) {
    segments.push({ start: 0, end: res.duration ?? 0, text: res.text.trim() });
  }
  return { text: res.text, language: res.language, segments };
}

/** Release the cached STT model (teardown). */
export function disposeStt(): void {
  sttPromise = null;
}
