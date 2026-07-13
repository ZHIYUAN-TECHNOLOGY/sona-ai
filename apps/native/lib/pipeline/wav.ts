// Minimal WAV (RIFF) utilities — pure, no native deps. Used by the native-file capture path
// (parse what the recorder wrote) and the STT self-test.

export interface ParsedWav {
  /** Sample rate from the fmt chunk. */
  rate: number;
  /** Mono float32 [-1,1] samples (first channel if multi-channel). */
  samples: Float32Array;
}

/** Parse a 16-bit PCM WAV. Walks chunks (handles non-canonical headers). Throws on non-PCM. */
export function parseWav(bytes: Uint8Array): ParsedWav {
  if (bytes.length < 44) throw new Error("wav too short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a RIFF/WAVE file");

  let off = 12;
  let rate = 16000;
  let channels = 1;
  let bits = 16;
  let dataOff = -1;
  let dataLen = 0;
  while (off + 8 <= bytes.length) {
    const id = tag(off);
    const size = view.getUint32(off + 4, true);
    if (id === "fmt ") {
      const format = view.getUint16(off + 8, true);
      if (format !== 1 && format !== 0xfffe) throw new Error(`unsupported wav format ${format}`);
      channels = view.getUint16(off + 10, true) || 1;
      rate = view.getUint32(off + 12, true) || 16000;
      bits = view.getUint16(off + 22, true) || 16;
    } else if (id === "data") {
      dataOff = off + 8;
      dataLen = size;
      break;
    }
    off += 8 + size + (size % 2);
  }
  if (dataOff < 0) throw new Error("wav data chunk not found");
  if (bits !== 16) throw new Error(`unsupported bit depth ${bits}`);

  const bytesAvail = Math.min(dataLen, bytes.length - dataOff);
  const frames = Math.floor(bytesAvail / 2 / channels);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = view.getInt16(dataOff + i * channels * 2, true) / 32768; // channel 0
  }
  return { rate, samples: out };
}

/** Linear-resample mono PCM to 16 kHz. No-op when already 16 kHz. */
export function resampleTo16k(input: Float32Array, inRate: number): Float32Array {
  const OUT = 16000;
  if (inRate === OUT || input.length === 0) return input;
  const ratio = inRate / OUT;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = input[i0];
    const b = i0 + 1 < input.length ? input[i0 + 1] : a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}
