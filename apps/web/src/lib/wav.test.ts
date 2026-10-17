// @ts-expect-error apps/web has no bun types yet (no new dependencies in this change); add @types/bun and drop this line.
import { expect, test } from "bun:test";

import { encodeWav, pcmToWav, resample, toBase64, WAV_HEADER } from "./wav";

test("a WAV header says 16 kHz, mono, 16-bit PCM, and the lengths add up", () => {
  const wav = encodeWav(new Float32Array([0, 1, -1, 2]));
  const view = new DataView(wav.buffer);
  const tag = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
  expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
  expect(wav.length).toBe(WAV_HEADER + 8);
  expect([view.getUint32(4, true), view.getUint32(40, true)]).toEqual([36 + 8, 8]);
  expect([view.getUint16(20, true), view.getUint16(22, true), view.getUint32(24, true), view.getUint32(28, true), view.getUint16(32, true), view.getUint16(34, true)]).toEqual([1, 1, 16_000, 32_000, 2, 16]);
  // Samples are clamped, not wrapped.
  expect([0, 1, 2, 3].map(i => view.getInt16(WAV_HEADER + i * 2, true))).toEqual([0, 32767, -32768, 32767]);
});

test("one second at 48 kHz becomes one second at 16 kHz", () => {
  const second = new Float32Array(48_000).fill(0.5);
  const down = resample(second, 48_000);
  expect(down.length).toBe(16_000);
  expect(down[100]).toBeCloseTo(0.5);
  expect(pcmToWav(second, 48_000).length).toBe(WAV_HEADER + 32_000);
  expect(resample(new Float32Array(8_000), 8_000).length).toBe(16_000);
  expect(resample(second, 16_000)).toBe(second);
});

test("base64 round-trips, past one chunk", () => {
  const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => i % 251);
  expect(Uint8Array.from(atob(toBase64(bytes)), c => c.charCodeAt(0))).toEqual(bytes);
});
