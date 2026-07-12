import type { SpeakerEmbedder } from "./embedder";
import { embedPcmMfcc, MFCC_EMBED_DIM } from "./mfcc";

// MFCC speaker embedder — a real, classical speaker feature that works on ACTUAL mic audio
// (the band-energy mock is tuned for the synth stand-in). Opt-in: NOT self-registered, so
// the synth demo + tests keep the verified band-energy default. Enable it for the real-mic
// paths (Diarization Lab, enrollment) via registerSpeakerEmbedder(mfccSpeakerEmbedder) when
// there's no neural .pte yet. The ECAPA .pte (executorchEmbedder) remains the best option.
//
// Its cosine scale is tight (real cepstral means are similar), so it carries a high
// threshold — the diarizer reads embedder.threshold instead of assuming the band-energy 0.9.

export const mfccSpeakerEmbedder: SpeakerEmbedder = {
  id: "mfcc-stats",
  dim: MFCC_EMBED_DIM,
  threshold: 0.99,
  embed: (pcm) => Promise.resolve(embedPcmMfcc(pcm)),
};
