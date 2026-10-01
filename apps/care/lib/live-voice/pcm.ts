/**
 * The mic as the voice agent hears it: 16 kHz mono, 16-bit little-endian PCM, in frames of about 100 ms (what the Agents
 * VoiceClient sends). iOS hands the recorder's audio over at 16 kHz already; a phone that gives 48 kHz is brought down
 * here. Pure, so bun can test it.
 */
export const RATE = 16_000;

/**
 * `samples` at `from` Hz, as `to` Hz, by linear interpolation between neighbours (as VoiceClient's capture worklet does).
 * ponytail: no low-pass before dropping the rate, so 8–24 kHz hiss folds in a little; fine for speech recognition,
 * and only phones that don't resample natively get here.
 */
export function resample(samples: Float32Array, from: number, to = RATE): Float32Array {
  if (from === to) return samples;
  const step = from / to, out = new Float32Array(Math.floor(samples.length / step));
  for (let i = 0; i < out.length; i++) {
    const at = i * step, j = Math.floor(at), f = at - j;
    out[i] = j + 1 < samples.length ? samples[j]! * (1 - f) + samples[j + 1]! * f : samples[j]!;
  }
  return out;
}

/** Loudness as root mean square (0 silent, about 0.05 quiet speech, 1 full scale). */
export function rms(samples: Float32Array) {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

/** Float samples (−1…1, clipped) as 16-bit little-endian PCM. */
export function toPcm16(samples: Float32Array): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(samples.length * 2));
  samples.forEach((s, i) => {
    const c = Math.max(-1, Math.min(1, s));
    view.setInt16(i * 2, c < 0 ? c * 0x8000 : c * 0x7fff, true);
  });
  return view.buffer;
}

/** 16-bit little-endian PCM (an agent set to send pcm16) as float samples. */
export function fromPcm16(data: ArrayBuffer): Float32Array<ArrayBuffer> {
  const view = new DataView(data), out = new Float32Array(data.byteLength >> 1);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}
