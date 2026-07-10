// Pure waveform math for the live mic visualiser. No native deps — every function
// here is deterministic and unit-tested (waveform.test.ts). The native mic capture
// (useMicAmplitude) feeds these; the SVG component renders buildWavePath's output.
//
// Moat note: these operate on transient amplitude only. Raw audio samples are read,
// reduced to a single loudness number, and discarded — never persisted or transmitted.

/** Root-mean-square loudness of a PCM frame (samples in -1..1). 0 for an empty frame. */
export function rms(samples: Float32Array | number[]): number {
  const n = samples.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / n);
}

/**
 * Map a raw RMS (speech typically sits ~0.01–0.2) to a 0..1 display amplitude:
 * subtract a noise floor, apply gain, clamp. Keeps quiet rooms flat and normal
 * speech lively without clipping.
 */
export function normalizeAmp(raw: number, gain = 6, floor = 0.008): number {
  const v = (raw - floor) * gain;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Push a value into a fixed-size ring (oldest drops off the front). Mutates and
 * returns `ring` so a Reanimated shared value's array can be updated in place on the
 * UI thread. `ring` is expected to be pre-filled to `size`.
 */
export function pushRing(ring: number[], value: number, size: number): number[] {
  ring.push(value);
  while (ring.length > size) ring.shift();
  return ring;
}

/** Round to 1 dp for a compact path string. */
function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Build a centred, vertically-mirrored waveform path from amplitudes (each 0..1)
 * across `width`×`height`. Uses quadratic segments through midpoints for a smooth,
 * premium curve. Returns an SVG path `d`. Marked `worklet` so it can run on the UI
 * thread inside useAnimatedProps; the directive is a harmless no-op under plain Node
 * (so this stays unit-testable). Fewer than 2 points → "".
 */
export function buildWavePath(amps: number[], width: number, height: number): string {
  "worklet";
  const n = amps.length;
  if (n < 2) return "";
  const midY = height / 2;
  const dx = width / (n - 1);
  const clamp = (a: number) => (a < 0 ? 0 : a > 1 ? 1 : a);
  const topY = (i: number) => midY - clamp(amps[i]) * midY;
  const botY = (i: number) => midY + clamp(amps[i]) * midY;

  // Top edge left→right, smoothed through midpoints.
  let d = `M 0 ${r1(topY(0))}`;
  for (let i = 1; i < n; i++) {
    const cx = (i - 1) * dx;
    const mx = r1(((i - 1) * dx + i * dx) / 2);
    const my = r1((topY(i - 1) + topY(i)) / 2);
    d += ` Q ${r1(cx)} ${r1(topY(i - 1))} ${mx} ${my}`;
  }
  d += ` L ${r1(width)} ${r1(topY(n - 1))}`;
  // Bottom edge right→left, mirrored.
  d += ` L ${r1(width)} ${r1(botY(n - 1))}`;
  for (let i = n - 2; i >= 0; i--) {
    const cx = (i + 1) * dx;
    const mx = r1((i * dx + (i + 1) * dx) / 2);
    const my = r1((botY(i + 1) + botY(i)) / 2);
    d += ` Q ${r1(cx)} ${r1(botY(i + 1))} ${mx} ${my}`;
  }
  d += ` L 0 ${r1(botY(0))} Z`;
  return d;
}
