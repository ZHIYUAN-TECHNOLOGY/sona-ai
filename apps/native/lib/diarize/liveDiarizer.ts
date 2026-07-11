import type { Speaker } from "../db/types";
import { diarize, type DiarizeOptions } from "./diarize";
import { getSpeakerEmbedder } from "./embedder";
import type { DiarTurn } from "./types";
// Type-only (erased) — the value side (detectSpeech/sliceSegments) is lazy-imported inside
// diarizeAudio so this module's testable core (diarizeWindows) never pulls the native VAD.
import type { SpeechSegment } from "./vad";

// Real audio → diarized speech. This is the production path that turns a captured waveform
// into "who spoke when": VAD finds speech regions, each region is embedded by the active
// speaker model, clustered into anonymous speakers, and assigned doctor/patient/other. All
// on-device. `diarizeWindows` is the native-free, testable core (pass pre-sliced windows);
// `diarizeAudio` adds the VAD front (needs the native VAD model).

export interface DiarizedSpeech {
  /** Segment start, seconds. */
  start: number;
  /** Segment end, seconds. */
  end: number;
  /** Anonymous acoustic cluster id. */
  cluster: number;
  /** Assigned role. */
  speaker: Speaker;
  /** Role-assignment confidence 0..1. */
  confidence: number;
  /** Aligned STT text, when available. */
  text?: string;
}

/**
 * Embed windows with the active embedder, cluster, and assign roles. Native-free and
 * testable — pass pre-sliced audio windows. Optional per-window text enables the linguistic
 * role classifier; without it, role assignment is acoustic (needs an enrolled voiceprint).
 */
export async function diarizeWindows(
  windows: Float32Array[],
  texts?: (string | undefined)[],
  opts: DiarizeOptions = {},
): Promise<DiarTurn[]> {
  if (windows.length === 0) return [];
  const embedder = getSpeakerEmbedder();
  const embeddings = await Promise.all(windows.map((w) => embedder.embed(w)));
  const utterances = embeddings.map((embedding, i) => ({ text: texts?.[i] ?? "", embedding }));
  return diarize(utterances, opts);
}

export interface DiarizeAudioOptions extends DiarizeOptions {
  sampleRate?: number;
  /** Drop speech regions shorter than this (seconds) — too little audio to embed reliably. */
  minSegmentSec?: number;
  /** VAD model source override (defaults to the shipped FSMN-VAD). */
  vadSource?: string;
  /** Per-segment STT text aligned to VAD segments, when available. */
  texts?: (string | undefined)[];
}

/**
 * Full real path: run VAD over a captured 16 kHz waveform, slice the speech regions, then
 * embed + cluster + assign roles. Returns diarized speech segments with timestamps.
 */
export async function diarizeAudio(
  waveform: Float32Array,
  opts: DiarizeAudioOptions = {},
): Promise<DiarizedSpeech[]> {
  const sampleRate = opts.sampleRate ?? 16000;
  const minLen = opts.minSegmentSec ?? 0.4;
  const { detectSpeech, sliceSegments } = await import("./vad");
  const segments = (await detectSpeech(waveform, opts.vadSource)).filter(
    (s: SpeechSegment) => s.end - s.start >= minLen,
  );
  if (segments.length === 0) return [];
  const windows = sliceSegments(waveform, segments, sampleRate);
  const turns = await diarizeWindows(windows, opts.texts, opts);
  return segments.map((s, i) => ({
    start: s.start,
    end: s.end,
    cluster: turns[i].cluster,
    speaker: turns[i].speaker,
    confidence: turns[i].confidence,
    text: opts.texts?.[i],
  }));
}
