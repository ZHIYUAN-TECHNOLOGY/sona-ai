import { logMelFbank } from "./features";
import type { Voiceprint } from "./types";

// MFCC-based speaker embedding — the classic, real speaker feature (pre-neural diarization
// used MFCC statistics). Pipeline: log-mel fbank → DCT-II across mel bands → cepstral
// coefficients (drop c0 = loudness) → pool mean + std over frames → the speaker vector.
// The cepstral MEAN captures a speaker's average vocal-tract timbre (kept, not subtracted —
// it IS the speaker signature); std captures its variation. Unlike the synth-tuned band-
// energy mock, this separates real voices reasonably for a 2-speaker consult. Pure DSP,
// on-device. The neural ECAPA .pte remains the accuracy upgrade (executorchEmbedder).

export interface MfccOptions {
  sampleRate?: number;
  numMel?: number;
  /** Cepstral coefficients kept (incl. c0, which is dropped) — 13 → a 12-d cepstrum. */
  numCoeffs?: number;
}

export const MFCC_DEFAULTS = { sampleRate: 16000, numMel: 40, numCoeffs: 13 } as const;

/** Extract the pooled MFCC speaker embedding from a PCM window. Unit-normalized. */
export function embedPcmMfcc(pcm: Float32Array, opts: MfccOptions = {}): Voiceprint {
  const sampleRate = opts.sampleRate ?? MFCC_DEFAULTS.sampleRate;
  const numMel = opts.numMel ?? MFCC_DEFAULTS.numMel;
  const numCoeffs = opts.numCoeffs ?? MFCC_DEFAULTS.numCoeffs;
  const mfccDim = numCoeffs - 1; // drop c0

  const fb = logMelFbank(pcm, { sampleRate, numMel });
  const out = new Float32Array(mfccDim * 2); // [mean(1..K-1), std(1..K-1)]
  if (fb.frames === 0) return out;

  // Precompute DCT-II basis: cos(pi/M * (n + 0.5) * k) for k=1..K-1, n=0..M-1.
  const basis: number[][] = Array.from({ length: mfccDim }, (_, i) => {
    const k = i + 1;
    return Array.from({ length: numMel }, (_, n) => Math.cos((Math.PI / numMel) * (n + 0.5) * k));
  });

  // Welford running mean + M2 per cepstral coefficient across frames.
  const mean = new Float64Array(mfccDim);
  const m2 = new Float64Array(mfccDim);
  for (let f = 0; f < fb.frames; f++) {
    const base = f * numMel;
    const count = f + 1;
    for (let i = 0; i < mfccDim; i++) {
      let c = 0;
      const bi = basis[i];
      for (let n = 0; n < numMel; n++) c += fb.data[base + n] * bi[n];
      const delta = c - mean[i];
      mean[i] += delta / count;
      m2[i] += delta * (c - mean[i]);
    }
  }

  let sumSq = 0;
  for (let i = 0; i < mfccDim; i++) {
    const std = fb.frames > 1 ? Math.sqrt(m2[i] / (fb.frames - 1)) : 0;
    out[i] = mean[i];
    out[mfccDim + i] = std;
    sumSq += out[i] * out[i] + out[mfccDim + i] * out[mfccDim + i];
  }
  const nrm = Math.sqrt(sumSq);
  if (nrm > 0) for (let i = 0; i < out.length; i++) out[i] /= nrm; // L2 normalize
  return out;
}

export const MFCC_EMBED_DIM = (MFCC_DEFAULTS.numCoeffs - 1) * 2;
