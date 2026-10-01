import { expect, test } from "bun:test";
import { base64, BYTES_PER_S, partialDue, wavSoFar } from "./partial-wav";
import { loudness } from "./turn";

// A WAV as iOS leaves it mid-recording: sizes still placeholders, an optional FLLR pad before the samples.
const ascii = s => [...s].map(c => c.charCodeAt(0));
function recording(pcm, fllr = 0) {
  const head = [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVEfmt "), 16, 0, 0, 0, ...Array(16).fill(1)];
  const pad = fllr ? [...ascii("FLLR"), fllr, 0, 0, 0, ...Array(fllr).fill(0)] : [];
  return Uint8Array.from([...head, ...pad, ...ascii("data"), 0, 0, 0, 0, ...Array.from({ length: pcm }, (_, i) => i % 251)]);
}
const u32 = (b, at) => new DataView(b.buffer).getUint32(at, true);

test("the WAV so far gets real RIFF and data sizes, in whole samples", () => {
  const wav = wavSoFar(recording(1001));
  expect(wav.length).toBe(44 + 1000);
  expect(u32(wav, 4)).toBe(wav.length - 8);
  expect(u32(wav, 40)).toBe(1000);
});

test("finds the samples after an FLLR pad", () => {
  const wav = wavSoFar(recording(400, 12));
  expect(wav.length).toBe(44 + 20 + 400);
  expect(u32(wav, 4)).toBe(wav.length - 8);
  expect(u32(wav, 60)).toBe(400);
});

test("keeps only the last seconds, under the server's audio limit", () => {
  const src = recording(3 * BYTES_PER_S);
  const wav = wavSoFar(src, 1);
  expect(u32(wav, 40)).toBe(BYTES_PER_S);
  expect(wav.at(-1)).toBe(src.at(-1));
  expect(wav[44]).toBe(src[src.length - BYTES_PER_S]);
});

test("not yet a WAV: nothing to send", () => {
  expect(wavSoFar(new Uint8Array(8))).toBeUndefined();
  expect(wavSoFar(recording(0).subarray(0, 40))).toBeUndefined();
});

test("base64 matches a plain encoding across slices", () => {
  const bytes = Uint8Array.from({ length: 20_000 }, (_, i) => (i * 7) % 256);
  expect(base64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
});

test("a partial goes once speech is heard, one at a time, with half a second more audio", () => {
  expect(partialDue({ busy: false, spoke: true, sent: 0, size: 20_000 })).toBe(true);
  expect(partialDue({ busy: true, spoke: true, sent: 0, size: 20_000 })).toBe(false);
  expect(partialDue({ busy: false, spoke: false, sent: 0, size: 20_000 })).toBe(false);
  expect(partialDue({ busy: false, spoke: true, sent: 20_000, size: 30_000 })).toBe(false);
});

test("loudness maps dBFS onto the bars", () => {
  expect(loudness(-160)).toBe(0);
  expect(loudness(-35)).toBe(0.5);
  expect(loudness(0)).toBe(1);
});
