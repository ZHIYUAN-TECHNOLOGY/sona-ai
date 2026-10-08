// The film scan's pure parts (features/imaging/film-scan.tsx): where the beam is, which way its wake trails, the clock.

/** One pass down the film; while the read is still out the beam comes back up at the same pace, and so on. */
export const SWEEP_S = 2.2;

/**
 * The beam `phase` into a round trip (0 to 1: down, then up): its height on the film (`beam`: 0 top, 1 bottom; a little past
 * both edges, so its glow clears them) and its wake, signed by the way it travels (+ down), long while the beam moves
 * fast and short where it slows to turn.
 */
export function beamAt(phase: number) {
  const a = 2 * Math.PI * phase, speed = Math.sin(a);
  return { beam: -0.04 + 1.08 * (0.5 - 0.5 * Math.cos(a)), wake: (speed >= 0 ? 1 : -1) * (0.03 + 0.22 * Math.abs(speed)) };
}

/** How long the read has taken, for the film's corner: "4.2 s". */
export const elapsed = (ms: number) => `${(Math.max(ms, 0) / 1000).toFixed(1)} s`;
