import { registerSpeakerEmbedder, type SpeakerEmbedder } from "./embedder";
import { SAMPLE_RATE } from "./mockAudio";
import type { Voiceprint } from "./types";

// Mock speaker embedder — REAL feature extraction over (synthetic) audio. It computes a
// log band-energy voiceprint via the Goertzel algorithm: for each of DIM log-spaced
// frequency bands, the average magnitude across overlapping frames, log-compressed and
// L2-normalized. A speaker's fundamental + harmonics light up a characteristic set of
// bands, so same-speaker windows land close in cosine space and different speakers apart.
// This is the seam: replace with an ECAPA-TDNN / sherpa-onnx embedding and clustering +
// role assignment are unchanged.

export const MOCK_EMBED_DIM = 24;

/** Log-spaced band center frequencies (Hz), 90..4000, precomputed once. */
const BANDS = (() => {
  const lo = Math.log(90);
  const hi = Math.log(4000);
  return Array.from({ length: MOCK_EMBED_DIM }, (_, i) =>
    Math.exp(lo + ((hi - lo) * i) / (MOCK_EMBED_DIM - 1)),
  );
})();

const FRAME = 512;
const HOP = 256;

/** Goertzel magnitude of `freq` over samples[start, start+len). */
function goertzel(samples: Float32Array, start: number, len: number, freq: number, sr: number): number {
  const w = (2 * Math.PI * freq) / sr;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = start; i < start + len; i++) {
    const s0 = samples[i] + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - c * s1 * s2;
  return power > 0 ? Math.sqrt(power) : 0;
}

/** Extract the log band-energy voiceprint from a PCM window. */
export function embedPcm(pcm: Float32Array, sr = SAMPLE_RATE): Voiceprint {
  const acc = new Float64Array(BANDS.length);
  let frames = 0;
  for (let start = 0; start + FRAME <= pcm.length; start += HOP) {
    for (let b = 0; b < BANDS.length; b++) acc[b] += goertzel(pcm, start, FRAME, BANDS[b], sr);
    frames++;
  }
  const vec = new Float32Array(BANDS.length);
  const denom = Math.max(1, frames);
  let mean = 0;
  for (let b = 0; b < BANDS.length; b++) {
    const v = Math.log1p(acc[b] / denom);
    vec[b] = v;
    mean += v;
  }
  mean /= BANDS.length;
  // Mean-subtract (cepstral-mean-subtraction analog): removes the common broadband
  // component so cosine reflects spectral SHAPE — pushing different speakers apart.
  let sumSq = 0;
  for (let b = 0; b < BANDS.length; b++) {
    vec[b] -= mean;
    sumSq += vec[b] * vec[b];
  }
  const nrm = Math.sqrt(sumSq);
  if (nrm > 0) for (let b = 0; b < BANDS.length; b++) vec[b] /= nrm; // L2 normalize
  return vec;
}

export const mockSpeakerEmbedder: SpeakerEmbedder = {
  id: "mock-goertzel-bands",
  dim: MOCK_EMBED_DIM,
  embed: (pcm) => embedPcm(pcm),
};

registerSpeakerEmbedder(mockSpeakerEmbedder);
