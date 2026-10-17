import { expect, test } from "bun:test";
import { fromPcm16, resample, rms, toPcm16 } from "./pcm";

test("48 kHz comes down to 16 kHz: a third of the samples, still on the same line", () => {
  const ramp = Float32Array.from({ length: 4800 }, (_, i) => i / 4800);
  const out = resample(ramp, 48_000);
  expect(out.length).toBe(1600);
  expect(out[0]).toBe(0);
  expect(out[100]).toBeCloseTo(300 / 4800, 6);
  expect(resample(new Float32Array(4410), 44_100).length).toBe(1600);
  // Already 16 kHz (iOS resamples natively): the same samples, untouched.
  const same = new Float32Array(1600);
  expect(resample(same, 16_000)).toBe(same);
});

test("loudness is the root mean square", () => {
  expect(rms(new Float32Array(160))).toBe(0);
  expect(rms(Float32Array.from({ length: 160 }, (_, i) => (i % 2 ? 1 : -1)))).toBe(1);
  expect(rms(Float32Array.from({ length: 1600 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * i) / 16)))).toBeCloseTo(0.5 / Math.SQRT2, 4);
  expect(rms(new Float32Array(0))).toBe(0);
});

test("samples become 16-bit little-endian PCM, clipped at full scale, and read back the same", () => {
  const pcm = toPcm16(Float32Array.from([0, 1, -1, 2, -2, 0.5]));
  expect([...new Int16Array(pcm)]).toEqual([0, 32767, -32768, 32767, -32768, 16383]);
  expect([...new Uint8Array(pcm).slice(10)]).toEqual([0xff, 0x3f]); // 16383, low byte first
  const back = fromPcm16(toPcm16(Float32Array.from([0.25, -0.75])));
  expect(back[0]).toBeCloseTo(0.25, 3);
  expect(back[1]).toBeCloseTo(-0.75, 3);
});
