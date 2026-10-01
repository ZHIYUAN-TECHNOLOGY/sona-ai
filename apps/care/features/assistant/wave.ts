/**
 * The dictation pill's numbers, kept pure so they can be tested. The recorder meters in dBFS: -55 dB
 * (a quiet room) and below draws the resting tick, -10 dB (a raised voice) the full bar. A floor keeps
 * every bar visible, so silence reads as "still listening", not as "broken".
 */
export const bar = (db: number) => Math.max(0.12, Math.min(1, (db + 55) / 45));

/** m:ss for the running timer (0:07, 1:02). */
export const clock = (ms: number) => {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
