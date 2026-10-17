/** What the speech model takes: 16 kHz, mono, 16-bit PCM in a WAV. Pure functions, no browser audio here. */
export const WAV_RATE = 16_000;
export const WAV_HEADER = 44;

/** Resample mono PCM: averages each window going down (a cheap low-pass), interpolates going up. */
export function resample(pcm: Float32Array, fromRate: number, toRate = WAV_RATE): Float32Array {
  if (fromRate === toRate) return pcm;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(pcm.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = i * ratio;
    if (ratio > 1) {
      const from = Math.floor(start), to = Math.min(pcm.length, Math.max(from + 1, Math.floor(start + ratio)));
      let sum = 0;
      for (let j = from; j < to; j++) sum += pcm[j]!;
      out[i] = sum / (to - from);
    } else {
      const at = Math.floor(start), next = Math.min(pcm.length - 1, at + 1);
      out[i] = pcm[at]! + (pcm[next]! - pcm[at]!) * (start - at);
    }
  }
  return out;
}

/** Mono float samples as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, rate = WAV_RATE): Uint8Array {
  const bytes = new Uint8Array(WAV_HEADER + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const tag = (at: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i)); };
  tag(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); tag(8, "WAVE");
  tag(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(WAV_HEADER + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/** Float32 PCM at any sample rate to 16 kHz mono 16-bit WAV bytes. */
export const pcmToWav = (pcm: Float32Array, fromRate: number) => encodeWav(resample(pcm, fromRate));

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
