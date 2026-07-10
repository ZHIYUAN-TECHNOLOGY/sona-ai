import type { Voiceprint } from "./types";

// Pluggable speaker-embedder boundary. Exactly one embedder is active at a time (only
// one model runs the audio→voiceprint step). The mock impl (mockEmbedder.ts) self-
// registers at load and produces a deterministic band-energy voiceprint so the whole
// diarization pipeline is testable headless; the real impl — an ECAPA-TDNN / sherpa-onnx
// speaker model via executorch, on-device — is a drop-in replacement with no consumer
// change (same seam mockStt.ts anticipates for STT).
//
// On-device only: an embedder turns raw audio into a biometric voiceprint. Neither the
// audio nor the voiceprint ever leaves the phone.

/** Turns one audio window (mono PCM, e.g. 16 kHz) into a fixed-dim voiceprint. */
export interface SpeakerEmbedder {
  id: string;
  /** Voiceprint dimensionality. */
  dim: number;
  /** Embed one audio window into a unit-normalized voiceprint. Pure/synchronous. */
  embed(pcm: Float32Array): Voiceprint;
}

let active: SpeakerEmbedder | null = null;

/** Register (or replace) the active speaker embedder. */
export function registerSpeakerEmbedder(embedder: SpeakerEmbedder): void {
  active = embedder;
}

/** The active embedder. Throws if none registered (import the mock or a real one first). */
export function getSpeakerEmbedder(): SpeakerEmbedder {
  if (!active) throw new Error("no speaker embedder registered — import lib/diarize to register the mock");
  return active;
}

/** Whether an embedder is available (for a settings / capability check). */
export function hasSpeakerEmbedder(): boolean {
  return active !== null;
}
