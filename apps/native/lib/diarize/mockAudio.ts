// Synthetic audio — the ONLY mocked part of the diarization spike. It stands in for
// the microphone: given a voice id (which real speaker) it deterministically builds a
// short waveform with a per-speaker fundamental + harmonic profile, so two utterances
// from the same speaker sound alike and different speakers sound apart. Everything
// downstream (embedding, clustering, role assignment) is real and blind to the voice id.
// Swap this + mockEmbedder for real mic PCM + an ECAPA/sherpa-onnx model and nothing
// else changes.

export const SAMPLE_RATE = 16_000;
const DUR_SEC = 0.32;

/** FNV-1a 32-bit hash of a string → stable uint32. */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 seeded PRNG → deterministic [0,1) stream (no Math.random, reproducible). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a synthetic mono PCM window for one utterance. `voiceId` sets the timbre
 * (fundamental + harmonic weights); `text` seeds small per-utterance variation so
 * same-speaker windows cluster tight without being identical. Deterministic.
 */
export function synthUtterancePcm(
  voiceId: string,
  text: string,
  sampleRate = SAMPLE_RATE,
): Float32Array {
  const vh = hashStr(voiceId);
  // Per-speaker fundamental 95..235 Hz, and speaker-specific harmonic energy weights.
  const base = 95 + (vh % 140);
  const h2w = 0.30 + ((vh >>> 4) % 55) / 100; // 0.30..0.85
  const h3w = 0.12 + ((vh >>> 9) % 45) / 100; // 0.12..0.57
  const h4w = 0.05 + ((vh >>> 13) % 30) / 100; // 0.05..0.35

  const rng = mulberry32(hashStr(`${voiceId}|${text}`));
  const f0 = base + (rng() - 0.5) * 6; // ±3 Hz utterance jitter

  const n = Math.round(sampleRate * DUR_SEC);
  const pcm = new Float32Array(n);
  const twoPi = Math.PI * 2;
  let peak = 1e-9;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let s =
      Math.sin(twoPi * f0 * t) +
      h2w * Math.sin(twoPi * 2 * f0 * t) +
      h3w * Math.sin(twoPi * 3 * f0 * t) +
      h4w * Math.sin(twoPi * 4 * f0 * t);
    s += (rng() - 0.5) * 0.06; // light broadband noise
    pcm[i] = s;
    const a = s < 0 ? -s : s;
    if (a > peak) peak = a;
  }
  for (let i = 0; i < n; i++) pcm[i] /= peak; // normalize to [-1,1]
  return pcm;
}
