/**
 * Live words while the clinician speaks. Sona speech (`voice.transcribe`) reads a whole file, not a stream, so every
 * PARTIAL_MS the dock sends the WAV recorded so far and shows what comes back; the pass on the finished file still wins.
 */
// 16 kHz mono 16-bit PCM (OPTIONS in voice-input): 32 000 bytes a second.
export const BYTES_PER_S = 32_000;
export const PARTIAL_MS = 1500;
// Half a second of new audio, or the partial would only repeat the last one.
const MIN_NEW = BYTES_PER_S / 2;
// The server takes ~40 s (MAX_AUDIO_BASE64, 1.8 M base64 chars); a turn stops at 30 s (MAX_MS), so this cap only bites
// if MAX_MS grows: a partial then hears the last 38 s and loses the start until the final pass reads the whole file.
export const PARTIAL_MAX_S = 38;

/** One partial in flight at most (a tick is skipped, not queued), only after speech, and only with new audio to read. */
export function partialDue({ busy, spoke, sent, size }: { busy: boolean; spoke: boolean; sent: number; size: number }) {
  return !busy && spoke && size - sent >= MIN_NEW;
}

/**
 * The WAV recorded so far, made readable: while recording, the RIFF and data sizes are still placeholders (iOS
 * finalises them on stop), so they are rewritten for the bytes actually here, cut to whole samples and to the last
 * `maxS` seconds. Undefined when the bytes are not a WAV yet (or not one at all).
 */
export function wavSoFar(bytes: Uint8Array, maxS = PARTIAL_MAX_S): Uint8Array | undefined {
  const tag = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Walk the chunks to "data": iOS pads the header with an "FLLR" chunk, so the samples don't always start at byte 44.
  let at = 12;
  while (at + 8 <= bytes.length && tag(at) !== "data") { const size = view.getUint32(at + 4, true); at += 8 + size + (size & 1); }
  if (at + 8 > bytes.length) return undefined;
  const start = at + 8, pcm = (bytes.length - start) & ~1, keep = Math.min(pcm, maxS * BYTES_PER_S);
  const out = new Uint8Array(start + keep);
  out.set(bytes.subarray(0, start));
  out.set(bytes.subarray(start + pcm - keep, start + pcm), start);
  const sizes = new DataView(out.buffer);
  sizes.setUint32(4, out.length - 8, true);
  sizes.setUint32(at + 4, keep, true);
  return out;
}

/** Bytes to base64 in slices (one `fromCharCode` over a whole recording overflows the argument limit). */
export function base64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x2000) s += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  return btoa(s);
}
